'use strict';

const net = require('node:net');

// Linux abstract UNIX sockets are represented by a leading NUL byte. Node's
// built-in net module supports that address format, so no NAN/native binding
// is required for dbus-next's session-bus connection.
function connect(address) {
  if (typeof address !== 'string' || !address.startsWith('\0')) {
    throw new TypeError('An abstract UNIX socket address must start with a NUL byte');
  }
  return net.createConnection({ path: address });
}

module.exports = { connect };
