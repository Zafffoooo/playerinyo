const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('Discord activity returns when Discord starts after playback', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/main.js'), 'utf8');
  const start = source.indexOf('// Discord RPC');
  const end = source.indexOf('// We use dynamic import', start);
  const runtimeStart = source.indexOf('async function reconcileDiscordRuntime(');
  const runtimeEnd = source.indexOf('async function reconcileRestoredRuntime(', runtimeStart);
  const snippet = source.slice(start, end) + source.slice(runtimeStart, runtimeEnd);
  let available = false;
  let retry;
  const clients = [];
  class Client extends EventEmitter {
    constructor() {
      super();
      this.activities = [];
      this.transport = { socket: null };
      clients.push(this);
    }
    async login(options) {
      this.clientId = options.clientId;
      if (!available) throw new Error('RPC_CONNECTION_TIMEOUT');
      this.emit('ready');
    }
    async request(command, args) {
      assert.equal(command, 'SET_ACTIVITY');
      this.activities.push(args.activity);
    }
    async clearActivity() {}
  }
  const context = {
    require: (id) => id === 'discord-rpc' ? { Client } : require(id),
    appSettings: { discordRpc: true, discordApplicationId: '123456789012345678', discordArtworkSource: 'online' },
    setInterval: (callback) => { retry = callback; return 1; },
    clearInterval: () => {},
    console,
    process,
    URL,
  };
  vm.createContext(context);
  vm.runInContext(`${snippet}\nthis.discordTest = { discordConnect, discordSetActivity, reconcileDiscordRuntime, resetDiscordConnection, discordArtworkUrl };`, context);
  await context.discordTest.discordSetActivity('Song', 'Artist', 'Album', Date.now());
  await context.discordTest.reconcileDiscordRuntime(true);
  assert.equal(clients[0].activities.length, 0);
  assert.equal(typeof retry, 'function');
  available = true;
  retry();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clients.length, 2);
  assert.equal(clients[1].activities.length, 1);
  assert.equal(clients[1].activities[0].details, 'Song');
  assert.equal(clients[1].activities[0].type, 2);
  assert.equal(clients[1].activities[0].assets.large_image, 'https://raw.githubusercontent.com/Zafffoooo/playerinyo/main/assets/icon.png');
  assert.equal(context.discordTest.discordArtworkUrl('file:///home/user/folder.jpg'), 'https://raw.githubusercontent.com/Zafffoooo/playerinyo/main/assets/icon.png');
  assert.equal(context.discordTest.discordArtworkUrl('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg'), 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  await context.discordTest.discordSetActivity('Song', 'Artist', 'Album', Date.now(), 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  assert.equal(clients[1].activities[1].assets.large_image, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  await context.discordTest.discordSetActivity('Song', 'Artist', 'Album', 1000000, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', 160000, '', 'playing');
  assert.equal(clients[1].activities[2].timestamps.start, 1000000);
  assert.equal(clients[1].activities[2].timestamps.end, 1160000);
  assert.equal(clients[1].clientId, '123456789012345678');
  context.appSettings.discordApplicationId = '987654321098765432';
  context.discordTest.resetDiscordConnection();
  await context.discordTest.discordConnect();
  assert.equal(clients[2].clientId, '987654321098765432');
  assert.equal(clients[2].activities[0].details, 'Song');
  context.appSettings.discordApplicationId = '';
  context.discordTest.resetDiscordConnection();
  await context.discordTest.discordConnect();
  assert.equal(clients[3].clientId, '1563774809563988080');
  assert.equal(clients[3].activities[0].details, 'Song');
});
