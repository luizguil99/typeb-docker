const express = require('express');
const WebSocket = require('ws');

const app = express();
const PORT = 61516;

app.use(express.json());

// Configurando o servidor HTTP
const server = app.listen(PORT, () => {
    console.log(`Servidor web socket ouvindo na porta ${PORT}`);
  });
  
// Configurando o servidor WebSocket
const wss = new WebSocket.Server({ server });

app.post('/webhook/:webhookId', async (req, res) => {
  try {
    const { webhookId } = req.params;
    
    const allData = []; // Supondo que você esteja enviando dados no corpo da requisição POST
    const paramsData = req.params;
    const bodyData = req.body;
    
    allData.push(paramsData);
    allData.push(bodyData);
   
    console.log(allData);
  
    // Enviar os dados para o canal correspondente no WebSocket
    wss.clients.forEach(client => {
      if (client.canalId === webhookId && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(allData));
      }
    });
  
    res.send('Dados enviados para o canal WebSocket.');
  } catch (error) {
    console.error('Erro ao processar a requisição:', error);
    res.status(500).send('Erro ao processar a requisição.');
  }
});

// Lidar com a conexão WebSocket
wss.on('connection', (ws, req) => {
  const canalId = req.url.split('/')[1];

  // Definindo o canalId na instância do WebSocket
  ws.canalId = canalId;

  console.log(`Cliente conectado ao canal ${canalId}`);

  // Agendar a desconexão após 10 segundos
  const disconnectTimeout = setTimeout(() => {
    ws.close();
    console.log(`Cliente desconectado do canal ${canalId} após 10 segundos`);
  }, 60000); // 5 minutos em milissegundos

  ws.on('message', (message) => {
    // Resetar o temporizador se receber alguma mensagem do cliente
    clearTimeout(disconnectTimeout);
  });

  ws.on('close', () => {
    clearTimeout(disconnectTimeout);
    console.log(`Cliente desconectado do canal ${canalId}`);
  });

});


