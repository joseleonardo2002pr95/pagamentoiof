const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const port = 3001;

// Configurações
const GHOST_SECRET_KEY = 'c3384669-4c6f-4932-a886-1b7e17e0653f';
const GHOST_API_BASE_URL = 'https://app.ghostspaysv1.com/api/v1';
const UTMIFY_TOKEN = 'RGmwZKZzwX9B9D37oJV2jlbCwEhK9DqUHceQ'; // Verifique se esse token está correto
const orderStore = {}; // Armazenamento temporário em memória

// Middlewares
app.use(bodyParser.json());
app.use(cors());

// Servir arquivos estáticos da pasta 'public' sob o caminho '/pagamentoiof'
app.use('/pagamentoiof', express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  index: 'index.html'
}));

// Rota explícita para garantir que /pagamentoiof sirva index.html
app.get('/pagamentoiof', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) {
      console.error('Erro ao servir index.html:', err);
      res.status(500).send('Erro ao carregar a página.');
    }
  });
});

// Função para enviar/atualizar na Utmify
async function enviarParaUtmify(orderData) {
  const currentDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const utmifyUrl = 'https://api.utmify.com.br/api-credentials/orders';

  const trackingParams = orderData.trackingParameters || {};
  const trackingParameters = {
    utm_source: trackingParams.utm_source || null,
    utm_medium: trackingParams.utm_medium || null,
    utm_campaign: trackingParams.utm_campaign || null,
    utm_term: trackingParams.utm_term || null,
    utm_content: trackingParams.utm_content || null,
    ...(trackingParams.utm_id && { utm_id: trackingParams.utm_id })
  };

  const payload = {
    orderId: orderData.orderId,
    platform: 'GhostsPay',
    paymentMethod: 'pix',
    status: orderData.status,
    createdAt: orderData.createdAt || currentDate,
    approvedDate: orderData.approvedDate || null,
    refundedAt: null,
    customer: {
      name: orderData.name || '',
      email: orderData.email || '',
      phone: orderData.phone || '',
      document: orderData.cpf || '',
      country: 'BR'
    },
    products: orderData.items ? orderData.items.map(item => ({
      id: 'IOF_TAX',
      name: item.title,
      quantity: item.quantity,
      priceInCents: item.unitPrice,
      planId: null,
      planName: 'Taxa IOF'
    })) : [],
    trackingParameters: trackingParameters,
    commission: {
      totalPriceInCents: orderData.amount || 0,
      gatewayFeeInCents: 0,
      userCommissionInCents: orderData.amount || 0,
      currency: 'BRL'
    },
    isTest: false
  };

  console.log('Enviando para Utmify - Token:', UTMIFY_TOKEN); // Log para depuração
  const method = orderData.status === 'paid' ? 'PUT' : 'POST';
  try {
    const response = await fetch(utmifyUrl, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-token': UTMIFY_TOKEN // Revertido para o cabeçalho correto
        // 'Authorization': `Bearer ${UTMIFY_TOKEN}` // Comente esta linha
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      console.error(`❌ Erro ao enviar para Utmify (${method}):`, {
        status: response.status,
        statusText: response.statusText,
        responseData: data
      });
    } else {
      console.log(`✅ Enviado/atualizado na Utmify com sucesso (${method}):`, data);
    }
    return response.ok;
  } catch (error) {
    console.error(`❌ Erro na requisição para Utmify (${orderData.status}):`, error);
    return false;
  }
}

// Endpoint para gerar o PIX
app.post('/pagamentoiof/api/gerar-pix', async (req, res) => {
  console.log('--- Nova Requisição para Gerar PIX ---');
  try {
    const { name, email, cpf, phone, amount, items, trackingParameters } = req.body;

    if (!name || !email || !cpf || !phone || !amount || !items || items.length === 0) {
      console.warn('Requisição de PIX inválida: dados ausentes ou incompletos.', req.body);
      return res.status(400).json({ message: 'Dados do cliente ou valor/itens ausentes.' });
    }

    const ghostRequestBody = {
      name, email, cpf, phone, paymentMethod: "PIX", amount, traceable: true, items
    };

    const responseGhost = await fetch(`${GHOST_API_BASE_URL}/transaction.purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': GHOST_SECRET_KEY
      },
      body: JSON.stringify(ghostRequestBody)
    });

    const responseText = await responseGhost.text();
    let dataGhost;
    try {
      dataGhost = JSON.parse(responseText);
    } catch (jsonParseError) {
      console.error('ERRO: Falha ao parsear a resposta da Ghost API como JSON.', jsonParseError);
      return res.status(500).json({ message: 'Resposta inválida da API externa.' });
    }

    if (responseGhost.ok) {
      const currentDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
      orderStore[dataGhost.id] = { name, email, cpf, phone, amount, items, trackingParameters, createdAt: currentDate };

      await enviarParaUtmify({
        orderId: dataGhost.id,
        status: 'waiting_payment',
        ...orderStore[dataGhost.id]
      });

      if (!dataGhost.pixQrCode || !dataGhost.pixCode) {
        console.error('Resposta da GhostsPay incompleta:', dataGhost);
        return res.status(500).json({ message: 'Dados do PIX não retornados pela API externa.' });
      }

      return res.status(200).json({
        pixQrCode: dataGhost.pixQrCode,
        pixCode: dataGhost.pixCode,
        transactionId: dataGhost.id,
        message: 'PIX gerado com sucesso!'
      });
    } else {
      console.error('Erro da API Ghost ao gerar PIX:', dataGhost);
      return res.status(responseGhost.status).json({ message: dataGhost.message || 'Erro ao gerar PIX.' });
    }
  } catch (error) {
    console.error('ERRO INTERNO DO SERVIDOR: Falha geral ao gerar PIX.', error);
    return res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});

// Endpoint para verificar o status do pagamento
app.get('/pagamentoiof/api/check-payment', async (req, res) => {
  console.log('--- Nova Requisição para Verificar Status do Pagamento ---');
  try {
    const { id } = req.query;

    if (!id) {
      console.warn('Requisição de verificação de pagamento inválida: ID da transação ausente.');
      return res.status(400).json({ message: 'ID da transação é obrigatório.' });
    }

    const responseGhost = await fetch(`${GHOST_API_BASE_URL}/transaction.getPayment?id=${id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': GHOST_SECRET_KEY
      }
    });

    const responseText = await responseGhost.text();
    let dataGhost;
    try {
      dataGhost = JSON.parse(responseText);
    } catch (jsonParseError) {
      console.error('ERRO: Falha ao parsear a resposta da Ghost API como JSON.', jsonParseError);
      return res.status(500).json({ message: 'Resposta inválida da API externa.' });
    }

    if (responseGhost.ok) {
      console.log('Status do pagamento obtido com sucesso:', dataGhost);

      if (dataGhost.status === 'APPROVED') {
        const approvedDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const orderData = orderStore[id] || {};
        if (Object.keys(orderData).length === 0) {
          console.error(`❌ Dados do pedido não encontrados para orderId: ${id}`);
          return res.status(500).json({ message: 'Dados do pedido não encontrados.' });
        }
        const utmifySuccess = await enviarParaUtmify({
          orderId: id,
          status: 'paid',
          approvedDate: approvedDate,
          ...orderData
        });
        if (!utmifySuccess) {
          console.warn('Falha ao atualizar o status na Utmify, mas prosseguindo com a resposta.');
        }
      }

      return res.status(200).json({
        status: dataGhost.status,
        message: 'Status do pagamento obtido com sucesso.'
      });
    } else {
      console.error('Erro da API Ghost ao verificar status do pagamento:', dataGhost);
      return res.status(responseGhost.status).json({ message: dataGhost.message || 'Erro ao verificar status.' });
    }
  } catch (error) {
    console.error('ERRO INTERNO DO SERVIDOR: Falha geral ao verificar status do pagamento.', error);
    return res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});

// Iniciar servidor
app.listen(port, '0.0.0.0', () => {
  console.log(`Backend rodando em http://localhost:${port}`);
  console.log(`Servindo arquivos estáticos da pasta 'public'.`);
  console.log('Aguardando requisições para /pagamentoiof/api/gerar-pix, /pagamentoiof/api/check-payment...');
});
