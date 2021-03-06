/**
 * @author Robin Duda
 *
 * Receives messages from the connector whenever the persistent
 * storage is to be queried or updated.
 *
 * Messages passed to this connector are returned as-is, this means
 * that the header stays intact and the response is appended to the query.
 */

require('./database');
var logging = require('./logging');
var account = require('./account');
var messaging = require('./messaging');
var rooms = require('./rooms');
var params = require('./../params');
var hmac = require('./hmac.js');
var handler = {};

var WebSocketServer = require('ws').Server,
    wss = new WebSocketServer({port: params.persistence.listenPort});

console.log("Persistence running on port " + params.persistence.listenPort);

module.exports = {
    handler: handler
};

wss.on('connection', function connection(socket) {

    socket.on('message', function incoming(message) {
        message = JSON.parse(message);
        logging.request();

        if (handler[message.header.action] != null)
            handler[message.header.action](socket, message);
    });

    socket.write = socket.send;

    // add interceptor.
    socket.send = function (data) {
        logging.response();
        socket.write(data);
    };
});

/**
 * Authenticates an user with the database.
 * @param socket connection to the server initiating the query.
 * @param message the parameters of the request. object {username, password}
 */
handler["authenticate"] = function (socket, message) {
    account.authenticate(message.username, message.password,
        function (result) {
            var token = hmac.generate(result.username);
            result.header = message.header;
            result.token = token.key;
            result.expiry = token.expiry;
            socket.send(JSON.stringify(result));
        });
};

/**
 * A chat message that should be forwarded to connected servers, the message
 * forwarded is also stored in the database as the message history for the room.
 * @param socket connection to the server initiating the query.
 * @param message to be broadcast. object {sender, content, room, command}
 */
handler["message"] = function (socket, message) {
    messaging.add(message);
};

/**
 * Changes the topic of a specified room.
 * @param socket socket connection to the server initiating the query.
 * @param message containing the room and new topic. object {room, topic}
 */
handler["topic"] = function (socket, message) {
    rooms.topic(message.room, message.topic);
};


/**
 * Removes a room and its associated history
 */
handler["registry.room"] = function (socket, message) {
    if (message.status == "DEPLETED") {
        rooms.clear(message.room);
        messaging.clear(message.room);
    }
};

/**
 * Creates a room if it does not exist, or returns it if it already exists.
 * @param socket connection to the server initiating the query.
 * @param message contains the query. object {room, topic, username, created: true | null}
 *      if the room is created the username is returned as the owner.
 */
handler["room"] = function (socket, message) {
    message.topic = (message.topic != null) ? message.topic : '/topic <string>';

    rooms.load(message.room, message.username, message.topic, function (result) {
        result.header = message.header;

        if (result.created)
            socket.send(JSON.stringify(result));
        else {
            messaging.history(message.room, function (history) {
                result.history = history;
                socket.send(JSON.stringify(result));
            });
        }
    });
};