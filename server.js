const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const port = 3001;

// --- CONFIGURAÇÕES IMPORTANTES ---
const GHOST_SECRET_KEY = 'c3384669-4c6f-4932-a886-1b7e17e0653f';
const GHOST_API_BASE_URL = 'https://app.ghostspaysv1.com/api/v1';

// --- MIDDLEWARES ---
app.use(bodyParser.json());
app.use(cors());
app.use('/pagamentoiof', express.static('public'));

// --- ROTAS DA API DO SEU BACKEND ---

// Endpoint para gerar o PIX
app.post('/pagamentoiof/api/gerar-pix', async (req, res) => {
    console.log('--- Nova Requisição para Gerar PIX ---');
    try {
        const { name, email, cpf, phone, amount, items } = req.body;

        // Validação básica dos dados recebidos do frontend
        if (!name || !email || !cpf || !phone || !amount || !items || items.length === 0) {
            console.warn('Requisição de PIX inválida: dados ausentes ou incompletos.', req.body);
            return res.status(400).json({ message: 'Dados do cliente ou valor/itens ausentes.' });
        }

        console.log('Recebida requisição para gerar PIX com os dados:', { name, email, cpf, phone, amount, items });

        const ghostRequestBody = {
            name: name,
            email: email,
            cpf: cpf,
            phone: phone,
            paymentMethod: "PIX",
            amount: amount,
            traceable: true,
            items: items
        };

        console.log('Enviando requisição para a Ghost API com body:', JSON.stringify(ghostRequestBody, null, 2));
        console.log(`URL da Ghost API: ${GHOST_API_BASE_URL}/transaction.purchase`);
        console.log(`Secret Key utilizada (parcial): ${GHOST_SECRET_KEY.substring(0, 8)}...`);

        const responseGhost = await fetch(`${GHOST_API_BASE_URL}/transaction.purchase`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': GHOST_SECRET_KEY
            },
            body: JSON.stringify(ghostRequestBody)
        });

        console.log(`Status da resposta da Ghost API: ${responseGhost.status} ${responseGhost.statusText}`);

        const responseText = await responseGhost.text();
        console.log('Resposta bruta da Ghost API (RAW TEXT):', responseText);

        try {
            const dataGhost = JSON.parse(responseText);

            if (responseGhost.ok) {
                console.log('PIX gerado com sucesso pela Ghost (JSON Response):', dataGhost);
                return res.status(200).json({
                    pixQrCode: dataGhost.pixQrCode,
                    pixCode: dataGhost.pixCode,
                    transactionId: dataGhost.id, // Inclui o ID da transação para polling
                    message: 'PIX gerado com sucesso!'
                });
            } else {
                console.error('Erro da API Ghost ao gerar PIX (JSON Response):', dataGhost);
                return res.status(responseGhost.status).json({ 
                    message: dataGhost.message || 'Erro ao gerar PIX na API externa.' 
                });
            }
        } catch (jsonParseError) {
            console.error('ERRO: Falha ao parsear a resposta da Ghost API como JSON.');
            console.error('Detalhes do erro de parse:', jsonParseError);
            console.error('Conteúdo que falhou ao parsear (provavelmente HTML de erro):', responseText);
            return res.status(500).json({ 
                message: 'Resposta inválida da API externa (não é JSON). Verifique os logs do servidor para detalhes.' 
            });
        }
    } catch (error) {
        console.error('ERRO INTERNO DO SERVIDOR: Falha geral ao gerar PIX.', error);
        return res.status(500).json({ message: 'Erro interno do servidor.' });
    } finally {
        console.log('--- Fim da Requisição ---');
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

        console.log(`Verificando status do pagamento para ID: ${id}`);

        const responseGhost = await fetch(`${GHOST_API_BASE_URL}/transaction.getPayment?id=${id}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': GHOST_SECRET_KEY
            }
        });

        console.log(`Status da resposta da Ghost API: ${responseGhost.status} ${responseGhost.statusText}`);

        const responseText = await responseGhost.text();
        console.log('Resposta bruta da Ghost API (RAW TEXT):', responseText);

        try {
            const dataGhost = JSON.parse(responseText);

            if (responseGhost.ok) {
                console.log('Status do pagamento obtido com sucesso:', dataGhost);
                return res.status(200).json({
                    status: dataGhost.status,
                    message: 'Status do pagamento obtido com sucesso.'
                });
            } else {
                console.error('Erro da API Ghost ao verificar status do pagamento:', dataGhost);
                return res.status(responseGhost.status).json({ 
                    message: dataGhost.message || 'Erro ao verificar status do pagamento na API externa.' 
                });
            }
        } catch (jsonParseError) {
            console.error('ERRO: Falha ao parsear a resposta da Ghost API como JSON.');
            console.error('Detalhes do erro de parse:', jsonParseError);
            console.error('Conteúdo que falhou ao parsear:', responseText);
            return res.status(500).json({ 
                message: 'Resposta inválida da API externa (não é JSON). Verifique os logs do servidor para detalhes.' 
            });
        }
    } catch (error) {
        console.error('ERRO INTERNO DO SERVIDOR: Falha geral ao verificar status do pagamento.', error);
        return res.status(500).json({ message: 'Erro interno do servidor.' });
    } finally {
        console.log('--- Fim da Requisição ---');
    }
});

// Iniciar servidor
app.listen(port, '0.0.0.0', () => {
    console.log(`Backend rodando em http://localhost:${port}`);
    console.log(`Servindo arquivos estáticos da pasta 'public'.`);
    console.log('Aguardando requisições para /pagamentoiof/api/gerar-pix, /pagamentoiof/api/check-payment...');
});