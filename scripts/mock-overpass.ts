import { createServer } from 'node:http';

const port = Number(process.env['MOCK_OVERPASS_PORT'] ?? 18080);
const payload = {
  elements: [
    {
      type: 'node',
      id: 900000001,
      lat: -22.9,
      lon: -47.1,
      tags: {
        name: '=Oficina, "São José"\nCentro',
        phone: '+5511999999999',
        'contact:whatsapp': '+5511999999999',
        'addr:street': 'Rua Teste',
        'addr:housenumber': '10',
        'addr:city': 'Campinas',
        'addr:state': 'SP',
      },
    },
  ],
};

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
});
server.listen(port, '0.0.0.0', () => console.log(`Mock Overpass listening on ${port}`));
const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
