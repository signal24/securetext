const { timeStamp } = require('console');
const crypto = require('crypto');
// const uuidLib = require('uuid');
const base62 = require('base-x')('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');

let senders = {};

const MODE_SENDER = 1;
const MODE_RECEIVER = 2;

class WebSocket {
    authorize(request, reply) {
        this.log = request.log;

        if (request.query.sender) {
            this.verifyReceiverEligibility(request, reply);
        }
    }

    handle(ws, request) {
        this.log.info('connected');

        this.ws = ws;
        this.ws.on('message', this.handleWsMessage.bind(this));
        this.ws.on('close', this.handleWsClosed.bind(this));

        this.disconnectTimeout = setTimeout(() => this.timeout(), 300000 /* 5 minutes */);

        if (request.query.sender) {
            this.log.info('setting up as receiver for ' + request.query.sender);
            this.makeMeAReceiver(request.query.sender);
        }

        else {
            this.log.info('setting up as sender');
            this.makeMeASender();
        }
    }

    makeMeASender() {
        const uuidBuf = crypto.randomBytes(8);
        const niceUuid = base62.encode(uuidBuf);
        this.uuid = niceUuid;
        this.log.info('configured UUID ' + this.uuid);

        this.role = MODE_SENDER;
        senders[this.uuid] = this;
        this.send({
            type: 'hello',
            uuid: this.uuid
        });
    }

    verifyReceiverEligibility(request, reply) {
        const senderUuid = request.query.sender;

        if (senders[senderUuid] === undefined) {
            reply.status(404).send('no such sender');
            return;
        }

        if (senders[senderUuid].receiver !== undefined) {
            reply.status(409).send('receiver already connected');
            return;
        }
    }

    makeMeAReceiver(senderUuid) {
        this.role = MODE_RECEIVER;
        this.sender = senders[senderUuid];
        this.sender.receiver = this;
    }

    handleWsMessage(message) {
        if (this.receiver !== undefined)
            this.receiver.ws.send(message);
        else if (this.sender !== undefined)
            this.sender.ws.send(message);
        else {
            this.log.error('data sent without established pipe');
            this.ws.close();
        }
    }

    handleWsClosed(e) {
        this.log.info('ws closed');

        if (this.role === MODE_SENDER) {
            delete senders[this.uuid];
            
            if (this.receiver) {
                delete this.receiver.sender;
                this.receiver.send({ type: 'sdisconnect' });
                this.receiver.ws.close();
            }
        } else if (this.role === MODE_RECEIVER) {
            if (this.sender) {
                delete this.sender.receiver;
                this.sender.send({ type: 'rdisconnect' });
            }
        }
    }

    send(obj) {
        this.ws.send(JSON.stringify(obj));
    }

    timeout() {
        this.log.info('closing timed out connection');
        this.ws.close();
    }
}

module.exports = WebSocket;