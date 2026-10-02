const { init } = require('./db');
const app = require('./app');
init().then(() => app.listen(process.env.PORT || 3000, () => console.log('API up')))
  .catch(e => { console.error(e); process.exit(1); });
