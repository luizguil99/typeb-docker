const express = require('express');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();
const moment = require('moment-timezone');
const fs = require('fs').promises;
const axios = require('axios');
const crypto = require('crypto');

const websocktServer = require('./web-socket-server.js')

const app = express();

const port = 61517

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(bodyParser.json());




function translateLogs(logs, excludedColumns = []) {
  const translations = {
    "message_id": "ID da Mensagem",
    "user_id": "ID do Usuário",
    "created_at": "Criado em",
    "trigger_time": "Tempo de Acionamento",
    "name": "Nome",
    "telephone": "Telefone",
    "trigger_status": "Status do Disparo",
    "error": "Erro",
    "content_error": "Conteúdo do Erro",
    "content_message": "Mensagem",
    "shipping_time": "Eviado em",
    "typeTrigger": "Tipo de Disparo"
    // Adicione mais traduções conforme necessário
  };

  return logs.map(log => {
    const translatedLog = {};
    Object.keys(log).forEach(key => {
      if (!excludedColumns.includes(key)) {
        translatedLog[translations[key] || key] = log[key];
      }
    });
    return translatedLog;
  });
}


//------------- ROTAS DO APP-------------\\


app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Verificar se o e-mail já está registrado
    const { data: existingUser } = await supabase
      .from('dp-v2-users')
      .select('id')
      .eq('user_email', email);

    if (existingUser && existingUser.length > 0) {
      return res.status(400).json({ error: 'E-mail já registrado' });
    }

    // Criptografar a senha antes de armazená-la
    const hashedPassword = await bcrypt.hash(password, 10);

    // Inserir usuário no banco de dados
    const { data: newUser, error } = await supabase
      .from('dp-v2-users')
      .insert([{ user_email: email, user_password: hashedPassword }]);

    if (error) {
      throw error;
    }

    res.status(201).json({ message: 'Registro bem-sucedido' });
  } catch (error) {
    console.error('Erro no registro:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Obter usuário pelo e-mail
    const { data: users } = await supabase
      .from('dp-v2-users')
      .select('id, user_email, user_password')
      .eq('user_email', email);

    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'O usuário não existe' });
    }

    // Verificar a senha
    const user = users[0];
    const passwordMatch = await bcrypt.compare(password, user.user_password);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'Senha inválida' });
    }

    // Gerar token JWT
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: '5h', // Token expira em 1 hora
    });

    res.status(200).json({ token });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/search-lines', async (req, res) => {
  try {
    const { jwt: token } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: users } = await supabase
      .from('dp-v2-users')
      .select('user_evolution_instances')
      .eq('id', decodedToken.userId);

    if (!users || users.length === 0 || users[0].user_evolution_instances === null) {
      return res.status(401).json({ messagem: "Instâncias não encontradas" });
    }

    const instances = users[0].user_evolution_instances;

    // Função para obter o status de uma instância
    const getInstanceStatus = async (instance) => {
      try {
        const apiUrl = process.env.EVOLUTION_API_URL; // Sua URL da API no arquivo .env
        const apiKey = process.env.EVOLUTION_API_KEY; // Sua chave de API no arquivo .env

        const response = await axios.get(`${apiUrl}/instance/fetchInstances?instanceName=${instance.instance}`, {
          headers: {
            'apikey': apiKey,
          },
        });

        // Extrair o status do objeto de resposta
        const status = response.data.instance.status;

        // Definir o valor da propriedade 'id' com base no status
        const statusBR = (status === 'open') ? 'Online' : 'Offline';

        return { status, statusBR };
      } catch (error) {
        console.error(`Erro ao obter status da instância ${instance.instance}:`, error);
        return { status: 'Erro ao obter status', statusBR: 'Erro ao obter id' };
      }
    };

    // Mapear as instâncias e obter o status e id para cada uma
    const instancesWithStatusAndId = await Promise.all(
      instances.map(async (instance) => {
        const { status, statusBR } = await getInstanceStatus(instance);
        return { ...instance, status, statusBR };
      })
    );

    res.status(200).json(instancesWithStatusAndId);
  } catch (error) {
    console.error('Erro na pesquisa de perfil:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/get-logs', async (req, res) => {
  try {
    const { jwt: token } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter logs pelo user_id do token na tabela dp-v2-logs
    const { data: logs } = await supabase
      .from('dp-v2-logs')
      .select('*')
      .eq('user_id', decodedToken.userId);

    if (!logs || logs.length === 0) {
      return res.status(404).json({ message: 'Nenhum log encontrado para o usuário' });
    }

    // Traduzir manualmente os cabeçalhos do JSON e excluir a coluna 'user_id'
    const translatedLogs = translateLogs(logs, ['user_id']);

    // Retornar os logs traduzidos
    res.status(200).json(translatedLogs);
  } catch (error) {
    console.error('Erro ao obter e traduzir logs:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/get-messages', async (req, res) => {
  try {
    const { jwt: token } = req.body;



    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);


    // Obter usuário pelo ID do token
    const { data: users } = await supabase
      .from('dp-v2-users')
      .select('profile_messages')
      .eq('id', decodedToken.userId);



    if (!users || users.length === 0 || users[0].profile_messages === null) {

      return res.status(200).json("Menssagens não encontrado");
    }

    // Se o usuário tem perfil, retorna o valor da coluna user_profile
    res.status(200).json(users[0].profile_messages);
  } catch (error) {
    console.error('Erro na pesquisa de menssagen:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});




//------------- ROTAS DE TRIGGER LIST -------------\\

app.post('/get-profile-trigger-list', async (req, res) => {
  try {
    const { jwt: token } = req.body;



    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);


    // Obter usuário pelo ID do token
    const { data: users } = await supabase
      .from('dp-v2-users')
      .select('*')
      .eq('id', decodedToken.userId);

    if (!users || users.length === 0 || users[0].profile_TriggerList === null) {

      // Se o usuário não tem perfil, retorna o conteúdo do arquivo data.json
      const jsonData = await fs.readFile('src/configs/triggerList.json', 'utf8');
      const jsonDataParsed = JSON.parse(jsonData);
      return res.status(200).json(jsonDataParsed);
    }

    // Se o usuário tem perfil, retorna o valor da coluna user_profile
    res.status(200).json( users[0].profile_TriggerList );
  } catch (error) {
    console.error('Erro na pesquisa de perfil:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/update-profile-list', async (req, res) => {
  try {
    const { jwt: token } = req.body
    const { typeInterval, interval, typeTrigger, line, message } = req.query;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o usuário do banco de dados pelo ID do token
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('*')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Obter o array de mensagens do usuário
    const profileArray = userData[0].profile_TriggerList;

    // Deserializar messageSelected se for uma string
    const messageArray = Array.isArray(message) ? message.map(JSON.parse) : JSON.parse(message);

    // Atualizar as propriedades com os valores recebidos da requisição
    profileArray.Profile.typeIntervalSelected = typeInterval;
    profileArray.Profile.intervalSelected = interval;
    profileArray.Profile.typeTriggerSelected = typeTrigger;
    profileArray.Profile.lineSelected = line;
    profileArray.Profile.messageSelected = messageArray;

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ profile_TriggerList: profileArray })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Configurações salvas com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar configurações:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/activeOrDisable-profile-list', async (req, res) => {
  try {
    const { jwt: token } = req.body
    const { status } = req.query;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o usuário do banco de dados pelo ID do token
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('*')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Obter o array de mensagens do usuário
    const profileArray = userData[0].profile_TriggerList;

    // Atualizar as propriedades com os valores recebidos da requisição
    profileArray.System.status = status;

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ profile_TriggerList: profileArray })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Configurações salvas com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar configurações:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/upload-file', async (req, res) => {
  try {
    const { jwt: token, contacts } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: user } = await supabase
      .from('dp-v2-users')
      .select('id')
      .eq('id', decodedToken.userId);

      //console.log(contacts)

    if (!user || user.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const userId = user[0].id;

    // Gerar ID aleatório de 55 caracteres
    const uploadTag = crypto.randomBytes(28).toString('hex');

    // Mapear a lista de contatos para o formato desejado
    const formattedContacts = contacts.slice(1).map(contact => {
      const formattedContact = {
        user_id: userId,
        name: contact[0],
        telephone: contact[1],
        upload_tag: uploadTag, // Adiciona o upload_tag
        variables: {} // Objeto para armazenar as variáveis
      };

      const headers = contacts[0]; // Cabeçalhos
      // Salvando as variáveis na coluna 'variables'
      for (let i = 2; i < contact.length; i++) {
        formattedContact.variables[headers[i]] = contact[i] || "";
      }

      return formattedContact;
    });

    // Inserir a lista de contatos na tabela dp-v2-trigger
    const { data: insertedContacts, error } = await supabase
      .from('dp-v2-trigger')
      .insert(formattedContacts);

    if (error) {
      throw error;
    }

    res.status(200).json({ message: 'Lista de contatos salva com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar lista de contatos:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/get-progress-profile-list', async (req, res) => {
  try {
    const { jwt: token } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: user } = await supabase
      .from('dp-v2-users')
      .select('id')
      .eq('id', decodedToken.userId);

    if (!user || user.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const userId = user[0].id;

    // Contar os itens na tabela dp-v2-trigger
    const { data: triggerCount } = await supabase
      .from('dp-v2-trigger')
      .select('count', { count: 'exact' })
      .eq('user_id', userId)
      .eq('typeTrigger', 'Disparador por Lista');

    // Contar os itens na outra tabela
    const { data: logsTableCount } = await supabase
      .from('dp-v2-logs')
      .select('count', { count: 'exact' })
      .eq('owner_id', userId)
      .eq('typeTrigger', 'Disparos por Lista');

    res.status(200).json({
      triggerCount: triggerCount[0].count,
      logsTableCount: logsTableCount[0].count
    });
  } catch (error) {
    console.error('Erro ao contar itens:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});




//------------- ROTAS DE TRIGGER EVENTS -------------\\

app.post('/get-profile-trigger-events', async (req, res) => {
  try {
    const { jwt: token } = req.body;



    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);


    // Obter usuário pelo ID do token
    const { data: users } = await supabase
      .from('dp-v2-users')
      .select('*')
      .eq('id', decodedToken.userId);

    if (!users || users.length === 0 || users[0].profile_TriggerEvents === null) {

      // Se o usuário não tem perfil, retorna o conteúdo do arquivo data.json
      const jsonData = await fs.readFile('src/configs/triggerList.json', 'utf8');
      const jsonDataParsed = JSON.parse(jsonData);
      return res.status(200).json(jsonDataParsed);
    }

    // Se o usuário tem perfil, retorna o valor da coluna user_profile
    res.status(200).json( users[0].profile_TriggerEvents );
  } catch (error) {
    console.error('Erro na pesquisa de perfil:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});


app.post('/update-profile-events', async (req, res) => {
  try {
    const { jwt: token } = req.body
    const { typeInterval, interval, typeTrigger, line, message } = req.query;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o usuário do banco de dados pelo ID do token
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('*')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Obter o array de mensagens do usuário
    const profileArray = userData[0].profile_TriggerEvents;

    // Deserializar messageSelected se for uma string
    const messageArray = Array.isArray(message) ? message.map(JSON.parse) : JSON.parse(message);

    // Atualizar as propriedades com os valores recebidos da requisição
    profileArray.Profile.typeTriggerSelected = typeTrigger;
    profileArray.Profile.lineSelected = line;
    profileArray.Profile.messageSelected = messageArray;

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ profile_TriggerEvents: profileArray })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Configurações salvas com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar configurações:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});






// Rota para iniciar o trigger
app.post('/start-triggerForEvents', async (req, res) => {
  try {
    const { jwt: token } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o usuário da tabela dp-v2-users pelo user_id
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('user_profile')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Atualizar o status do triggerForList para "Ativado" dentro de user_profile
    const updatedUserProfile = {
      ...userData[0].user_profile,
      triggerForEventos: {
        ...userData[0].user_profile.triggerForEventos,
        status: 'Ativado'
      }
    };

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ user_profile: updatedUserProfile })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Trigger iniciado com sucesso' });
  } catch (error) {
    console.error('Erro ao iniciar o trigger:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Rota para parar o trigger
app.post('/stop-triggerForEvents', async (req, res) => {
  try {
    const { jwt: token } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o usuário da tabela dp-v2-users pelo user_id
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('user_profile')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Atualizar o status do triggerForList para "Desativado" dentro de user_profile
    const updatedUserProfile = {
      ...userData[0].user_profile,
      triggerForEventos: {
        ...userData[0].user_profile.triggerForEventos,
        status: 'Desativado'
      }
    };

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ user_profile: updatedUserProfile })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Trigger parado com sucesso' });
  } catch (error) {
    console.error('Erro ao parar o trigger:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});



app.post('/progress-events', async (req, res) => {
  try {
    const { jwt: token } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: user } = await supabase
      .from('dp-v2-users')
      .select('id')
      .eq('id', decodedToken.userId);

    if (!user || user.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const userId = user[0].id;

    // Contar os itens na outra tabela
    const { data: logsTableCount } = await supabase
      .from('dp-v2-logs')
      .select('count', { count: 'exact' })
      .eq('user_id', userId)
      .eq('typeTrigger', 'Disparador por Eventos');

    res.status(200).json({
      logsTableCount: logsTableCount[0].count
    });
  } catch (error) {
    console.error('Erro ao contar itens:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Rota para limpar os itens da tabela dp-v2-trigger
app.post('/clear-trigger-items', async (req, res) => {
  try {
    const { jwt: token } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: user } = await supabase
      .from('dp-v2-users')
      .select('id')
      .eq('id', decodedToken.userId);

    if (!user || user.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const userId = user[0].id;

    // Remover os itens da tabela dp-v2-trigger com user_id correspondente
    await supabase
      .from('dp-v2-trigger')
      .delete()
      .eq('user_id', userId)
      .eq('typeTrigger', 'Disparador por Lista');

    res.status(200).json({ message: 'Disparos removidos com sucesso' });
  } catch (error) {
    console.error('Erro ao limpar itens da tabela dp-v2-trigger:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Rota para limpar os itens da tabela dp-v2-trigger
app.post('/clear-logs-items', async (req, res) => {
  try {
    const { jwt: token } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: user } = await supabase
      .from('dp-v2-users')
      .select('id')
      .eq('id', decodedToken.userId);


    if (!user || user.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const userId = user[0].id;

    // Remover os itens da tabela dp-v2-trigger com user_id correspondente
    await supabase
      .from('dp-v2-logs')
      .delete()
      .eq('user_id', userId)
      .eq('typeTrigger', 'Disparador por Lista');

    res.status(200).json({ message: 'Logs removidos com sucesso' });
  } catch (error) {
    console.error('Erro ao limpar itens da tabela dp-v2-trigger:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Rota para limpar os itens da tabela dp-v2-trigger
app.post('/clear-logs-items-events', async (req, res) => {
  try {
    const { jwt: token } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: user } = await supabase
      .from('dp-v2-users')
      .select('id')
      .eq('id', decodedToken.userId);


    if (!user || user.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const userId = user[0].id;

    // Remover os itens da tabela dp-v2-trigger com user_id correspondente
    await supabase
      .from('dp-v2-logs')
      .delete()
      .eq('user_id', userId)
      .eq('typeTrigger', 'Disparador por Eventos');

    res.status(200).json({ message: 'Logs removidos com sucesso' });
  } catch (error) {
    console.error('Erro ao limpar itens da tabela dp-v2-trigger:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Rota para limpar os itens das duas tabelas dp-v2-trigger e dp-v2-logs
app.post('/clear-all-items', async (req, res) => {
  try {
    const { jwt: token } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: user } = await supabase
      .from('dp-v2-users')
      .select('id')
      .eq('id', decodedToken.userId);


    if (!user || user.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const userId = user[0].id;

    // Remover os itens da tabela dp-v2-trigger com user_id correspondente
    await supabase
      .from('dp-v2-trigger')
      .delete()
      .eq('user_id', userId)
      .eq('typeTrigger', 'Disparador por Lista');

    // Remover os itens da tabela dp-v2-logs com user_id correspondente
    await supabase
      .from('dp-v2-logs')
      .delete()
      .eq('user_id', userId)
      .eq('typeTrigger', 'Disparador por Lista');

    res.status(200).json({ message: 'Historico e Disparos removidos com sucesso' });
  } catch (error) {
    console.error('Erro ao limpar itens das tabelas dp-v2-trigger e dp-v2-logs:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Rota para obter o webhook_id do usuário
app.post('/get-webhook-id', async (req, res) => {
  try {
    const { jwt: token } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o usuário da tabela dp-v2-users pelo ID do token
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('webhook_id')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0 || !userData[0].webhook_id) {
      return res.status(404).json({ message: 'Webhook ID não encontrado para o usuário' });
    }

    const webhookId = userData[0].webhook_id;

    res.status(200).json({ webhook_id: webhookId });
  } catch (error) {
    console.error('Erro ao obter o webhook ID:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Rota para salvar eventos dentro de triggerForEventos.events
app.post('/save-events', async (req, res) => {
  try {
    const { jwt: token, events } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o usuário do banco de dados pelo ID do token
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('user_profile')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Atualizar o perfil do usuário com os eventos adicionados
    const userProfile = userData[0].user_profile;
    userProfile.triggerForEventos.events = events;

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ user_profile: userProfile })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Eventos salvos com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar eventos:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/add-instance', async (req, res) => {
  try {
    const { jwt: token, instanceName } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('user_evolution_instances')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    // Verificar se a instância já existe
    const existingInstance = userData[0].user_evolution_instances.find(instance => instance.name === instanceName);
    if (existingInstance) {
      return res.status(200).json({ msg: 'Instância já existe' });
    }

    const apiUrl = process.env.EVOLUTION_API_URL; // Sua URL da API no arquivo .env
    const apiKey = process.env.EVOLUTION_API_KEY; // Sua chave de API no arquivo .env

    const instanceNameEvolution = "user-dp-v2-" + decodedToken.userId + "-" + instanceName

    // Fazer requisição para criar a instância
    const reqUrl = `${apiUrl}/instance/create`;
    const axiosConfig = {
      headers: {
        'apikey': apiKey,
      }
    };
    const axiosBody = {
      instanceName: instanceNameEvolution,
      token: '', // Coloque o token correto aqui
      integration: "WHATSAPP-BAILEYS",
      qrcode: true
    };

    const response = await axios.post(reqUrl, axiosBody, axiosConfig);
    const { hash: { apikey } } = response.data;

    // Adicionar a nova instância ao JSON
    const newInstance = {
      name: instanceName,
      apykei: apikey,
      instance: instanceNameEvolution
    };
    userData[0].user_evolution_instances.push(newInstance);

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ user_evolution_instances: userData[0].user_evolution_instances })
      .eq('id', decodedToken.userId);

    res.status(200).json({ msg: 'Instância adicionada com sucesso' });
  } catch (error) {
    console.error('Erro ao adicionar instância:', error.response.data);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.delete('/delete-instance/:instanceNameEvolution', async (req, res) => {
  try {
    const { jwt: token } = req.body;
    const { instanceNameEvolution } = req.params;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('user_evolution_instances')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    // Verificar se a instância existe no array de instâncias do usuário
    const index = userData[0].user_evolution_instances.findIndex(instance => instance.instance === instanceNameEvolution);
    if (index === -1) {
      return res.status(404).json({ error: 'Instância não encontrada' });
    }

    const apiUrl = process.env.EVOLUTION_API_URL; // Sua URL da API no arquivo .env
    const apiKey = process.env.EVOLUTION_API_KEY; // Sua chave de API no arquivo .env

    // Fazer requisição para deletar a instância
    const reqUrl = `${apiUrl}/instance/delete/${instanceNameEvolution}`;
    const axiosConfig = {
      headers: {
        'apikey': apiKey,
      }
    };

    await axios.delete(reqUrl, axiosConfig);

    // Remover a instância do array de instâncias do usuário
    userData[0].user_evolution_instances.splice(index, 1);

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ user_evolution_instances: userData[0].user_evolution_instances, last_line: null })
      .eq('id', decodedToken.userId);

    res.status(200).json({ msg: 'Instância deletada com sucesso' });
  } catch (error) {
    console.error('Erro ao deletar instância:', error.response.data);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Rota para adicionar mensagens ao perfil do usuário
app.post('/update-messages', async (req, res) => {
  try {
    const { jwt: token, messages } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o perfil do usuário
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('user_profile')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Atualizar o array de mensagens no perfil do usuário
    const updatedUserProfile = {
      ...userData[0].user_profile,
      messages: messages
    };

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ user_profile: updatedUserProfile })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Mensagens atualizadas com sucesso' });
  } catch (error) {
    console.error('Erro ao adicionar mensagens:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Rota para adicionar mensagens ao perfil do usuário
app.post('/update-events', async (req, res) => {
  try {
    const { jwt: token, events } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o perfil do usuário
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('user_profile')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Atualizar o array de mensagens no perfil do usuário
    const updatedUserProfile = {
      ...userData[0].user_profile,
      events: events, // Aqui é o evento que está sendo atualizado
      triggerForEventos: events // Corrigindo a referência aqui para events
    };

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ user_profile: updatedUserProfile })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Eventos atualizadas com sucesso' });
  } catch (error) {
    console.error('Erro ao adicionar mensagens:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Rota para adicionar mensagens ao perfil do usuário
app.post('/update-openingHours', async (req, res) => {
  try {
    const { jwt: token, data } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o perfil do usuário
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('*')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ opening_hours: data })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Opening_hours atualizadas com sucesso' });
  } catch (error) {
    console.error('Erro ao adicionar opening_hours:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Endpoint para pesquisa de perfil de usuário
app.post('/search-openingHours', async (req, res) => {
  try {
    const { jwt: token } = req.body;



    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);


    // Obter usuário pelo ID do token
    const { data: users } = await supabase
      .from('dp-v2-users')
      .select('opening_hours')
      .eq('id', decodedToken.userId);



    if (users) {
      res.status(200).json( users[0].opening_hours );
    } else {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }



  } catch (error) {
    console.error('Erro na pesquisa de perfil:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Endpoint para pesquisa de perfil de usuário
app.post('/search-profile-triggerLeads', async (req, res) => {
  try {
    const { jwt: token } = req.body;



    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);


    // Obter usuário pelo ID do token
    const { data: users } = await supabase
      .from('dp-v2-users')
      .select('profile_TriggerLeads')
      .eq('id', decodedToken.userId);



    if (!users || users.length === 0 || users[0].profile_TriggerLeads === null) {

      return res.status(200).json("Perfil não encontrado");
    }

    // Se o usuário tem perfil, retorna o valor da coluna user_profile
    res.status(200).json(users[0].profile_TriggerLeads);
  } catch (error) {
    console.error('Erro na pesquisa de perfil:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});


// Rota para salvar eventos dentro de triggerForEventos.events
app.post('/add-profile-messages', async (req, res) => {
  try {
    const { jwt: token, message } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o usuário do banco de dados pelo ID do token
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('profile_messages')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Atualizar o perfil do usuário com os eventos adicionados
    const messagesArray = userData[0].profile_messages;

    console.log(messagesArray)

    const existingMessage = messagesArray.find(item => item.name === message.name);

    if (existingMessage) {
      return res.status(400).json({ message: 'Já existe uma mensagem com esse nome' });
    }

    messagesArray.push(message);
  
  // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ profile_messages: messagesArray })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Mensagens salvos com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar Mensagens:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Rota para remover eventos dentro de triggerForEventos.events
app.delete('/remove-profile-message', async (req, res) => {
  try {
    const { jwt: token } = req.body
    const { name } = req.query;

    //console.log(name)

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o usuário do banco de dados pelo ID do token
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('profile_messages')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Obter o array de mensagens do usuário
    const messagesArray = userData[0].profile_messages;

    // Encontrar o índice da mensagem com o nome fornecido
    const index = messagesArray.findIndex(item => item.name === name);

    if (index === -1) {
      return res.status(404).json({ message: 'Mensagem não encontrada' });
    }

    // Remover a mensagem do array
    messagesArray.splice(index, 1);

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ profile_messages: messagesArray })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Mensagem removida com sucesso' });
  } catch (error) {
    console.error('Erro ao remover mensagem:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});



// Rota para salvar eventos dentro de triggerForEventos.events
app.post('/add-profile-rule', async (req, res) => {
  try {
    const { jwt: token, rule } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o usuário do banco de dados pelo ID do token
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('profile_TriggerLeads_rules')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Atualizar o perfil do usuário com os eventos adicionados
    const rulesArray = userData[0].profile_TriggerLeads_rules;

    //console.log(rulesArray)

    const existingRule = rulesArray.find(item => item.name === rule.name);

    if (existingRule) {
      return res.status(400).json({ message: 'Já existe uma regra com esse nome' });
    }

    rulesArray.push(rule);
  
  // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ profile_TriggerLeads_rules: rulesArray })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Regra salvos com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar regra:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Rota para remover eventos dentro de triggerForEventos.events
app.delete('/remove-profile-rule', async (req, res) => {
  try {
    const { jwt: token } = req.body
    const { name } = req.query;

    //console.log(name)

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o usuário do banco de dados pelo ID do token
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('profile_TriggerLeads_rules')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Obter o array de mensagens do usuário
    const rulesArray = userData[0].profile_TriggerLeads_rules;

    // Encontrar o índice da mensagem com o nome fornecido
    const index = rulesArray.findIndex(item => item.name === name);

    if (index === -1) {
      return res.status(404).json({ message: 'Mensagem não encontrada' });
    }

    // Remover a mensagem do array
    rulesArray.splice(index, 1);

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ profile_TriggerLeads_rules: rulesArray })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Regras removida com sucesso' });
  } catch (error) {
    console.error('Erro ao remover regra:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/get-rules', async (req, res) => {
  try {
    const { jwt: token } = req.body;



    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);


    // Obter usuário pelo ID do token
    const { data: users } = await supabase
      .from('dp-v2-users')
      .select('profile_TriggerLeads_rules')
      .eq('id', decodedToken.userId);



    if (!users || users.length === 0 || users[0].profile_TriggerLeads_rules === null) {

      return res.status(200).json("Regras não encontrado");
    }

    // Se o usuário tem perfil, retorna o valor da coluna user_profile
    res.status(200).json(users[0].profile_TriggerLeads_rules);
  } catch (error) {
    console.error('Erro na pesquisa de menssagen:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/update-profile_TriggerLeads', async (req, res) => {
  try {
    const { jwt: token } = req.body
    const { typeInterval, interval, typeTrigger, line, message, rule } = req.query;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o usuário do banco de dados pelo ID do token
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('profile_TriggerLeads')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Obter o array de mensagens do usuário
    const profileArray = userData[0].profile_TriggerLeads;

    // Deserializar messageSelected se for uma string
    const messageArray = Array.isArray(message) ? message.map(JSON.parse) : JSON.parse(message);

    // Atualizar as propriedades com os valores recebidos da requisição
    profileArray.Profile.typeIntervalSelected = typeInterval;
    profileArray.Profile.intervalSelected = interval;
    profileArray.Profile.typeTriggerSelected = typeTrigger;
    profileArray.Profile.lineSelected = line;
    profileArray.Profile.messageSelected = messageArray;
    profileArray.Profile.ruleSelected = rule;

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ profile_TriggerLeads: profileArray })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Configurações salvas com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar configurações:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/activeOrDisable_TriggerLeads', async (req, res) => {
  try {
    const { jwt: token } = req.body
    const { status } = req.query;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter o usuário do banco de dados pelo ID do token
    const { data: userData } = await supabase
      .from('dp-v2-users')
      .select('profile_TriggerLeads')
      .eq('id', decodedToken.userId);

    if (!userData || userData.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Obter o array de mensagens do usuário
    const profileArray = userData[0].profile_TriggerLeads;

    // Atualizar as propriedades com os valores recebidos da requisição
    profileArray.System.status = status;

    // Atualizar o registro no banco de dados
    await supabase
      .from('dp-v2-users')
      .update({ profile_TriggerLeads: profileArray })
      .eq('id', decodedToken.userId);

    res.status(200).json({ message: 'Configurações salvas com sucesso' });
  } catch (error) {
    console.error('Erro ao salvar configurações:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/get-progress-triggerLeads', async (req, res) => {
  try {
    const { jwt: token } = req.body;

    // Verificar se o token é válido
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    // Obter usuário pelo ID do token
    const { data: user } = await supabase
      .from('dp-v2-users')
      .select('*')
      .eq('id', decodedToken.userId);

    if (!user || user.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const userId = user[0].id;

    const codeTrigger = user[0].profile_TriggerLeads.System.codeTrigger
    //console.log(codeTrigger)

    // Contar os itens na outra tabela apenas com owner_id selecionados
    const { data: onlyOwnerIdCount } = await supabase
      .from('dp-v2-leads')
      .select('count', { count: 'exact' })
      .eq('owner_id', userId) // Verifica se last_code_trigger é null

    // Contar os itens na outra tabela com owner_id e codeTrigger selecionados
    const { data: ownerIdAndCodeTriggerCount } = await supabase
      .from('dp-v2-leads')
      .select('count', { count: 'exact' })
      .eq('owner_id', userId)
      .eq('last_code_trigger', codeTrigger);

    res.status(200).json({
      onlyOwnerIdCount: onlyOwnerIdCount[0].count,
      ownerIdAndCodeTriggerCount: ownerIdAndCodeTriggerCount[0].count
    });

  } catch (error) {
    console.error('Erro ao contar itens:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});





app.listen(port, () => {
  console.log(`Servidor principal rodando na porta ${port}`);
});


