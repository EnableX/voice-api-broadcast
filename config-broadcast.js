const config = {};

config.app_name = 'TEST_APP';
config.voice_server_host = 'api.enablex.io';
config.voice_server_port = 443;
config.path = '/voice/v1/broadcast';
config.app_id = '';
config.app_key = '';
config.enablex_number = '';
config.webhook_port = 5000;
config.interval_between_retries = 5000;
config.number_of_retries = 3;
config.ngrok = true;
config.webhook_host = 'webhook.example.io'; // Needs to provide if ngrok = false
config.broadcast_list = [
  { phone: '919999999991' },
  { phone: '919999999992' },
  { phone: '919999999993' },
  { phone: '919999999994' },
];
config.certificate = {
  ssl_key: '/certs/example.key', // Path to .key file
  ssl_cert: '/certs/example.crt', // Path to .crt file
  ssl_ca_certs: ['/certs/example.ca-bundle'], // Path to CA[chain]
};

module.exports = config;
