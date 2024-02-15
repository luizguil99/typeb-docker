const WebSocket = require('ws');

const socket = new WebSocket('ws://localhost:61516/e6e8ce9d-6ca0-43c7-9a16-c5cee64344569');

socket.onopen = () => {
  console.log('Conexão estabelecida com sucesso.');
};

socket.onmessage = (event) => {
  const data = event.data;
  
  // Verificando se há dados recebidos
  if (data) {
    try {
      const parsedData = JSON.parse(data);
      console.log('Dados recebidos:', parsedData);
    } catch (error) {
      console.error('Erro ao analisar os dados JSON:', error);
    }
  } else {
    console.warn('Dados recebidos estão vazios.');
  }
};

socket.onerror = (error) => {
  console.error('Erro na conexão WebSocket:', error);
};

socket.onclose = () => {
  console.log('Conexão fechada.');
};
