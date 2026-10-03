// PM2 process config for production. Keep instances at 1: the send queue runs inside
// the server process, and two copies would race on the same campaigns.
module.exports = {
  apps: [{
    name: 'mailpilot',
    script: 'src/index.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    env: { NODE_ENV: 'production', HOST: '127.0.0.1' },
    max_memory_restart: '700M',
    time: true,
  }],
};
