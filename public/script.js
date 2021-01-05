function app() {
    return {
        error: null,
        role: null,
        isConnected: false,
        link: null,
        magicNumbers: null,
        messageInput: null,
        message: null,
        hasFinished: false,

        init() {
            const baseUrl = location.protocol.replace('http', 'ws') + '//' + location.host + '/ws';
            const senderId = location.hash.length > 2 ? location.hash.substr(1) : null;
            const url = senderId ? `${baseUrl}?sender=${senderId}` : baseUrl;

            if (senderId ? this.role = 'receiver' : this.role = 'sender');

            this.ws = new WebSocket(url);
            this.ws.addEventListener('open', this._handleWsOpened.bind(this));
            this.ws.addEventListener('message', this._handleWsMessage.bind(this));
            this.ws.addEventListener('close', this._handleWsClosed.bind(this));
            this.ws.addEventListener('error', this._handleWsError.bind(this));

            this.textEncoder = new TextEncoder();
            this.textDecoder = new TextDecoder();

            window.addEventListener('hashchange', () => location.reload());
            setTimeout(() => this.$refs.message.focus(), 100);
        },

        _handleWsOpened() {
            if (this.role == 'receiver') {
                this.setupReceiver();
            }
        },

        _handleWsMessage(e) {
            let json;
            try {
                json = JSON.parse(e.data);
            } catch (err) {
                console.log(e.data);
                throw new Error('failed to parse JSON:' + err);
            }

            let fn = 'handle' + json.type.substr(0, 1).toUpperCase() + json.type.substr(1) + 'Message';
            if (this[fn]) {
                this[fn](json);
            } else {
                console.log(json);
                throw new Error('unexpected message type');
            }
        },

        _handleWsClosed() {
            if (!this.hasFinished && !this.error) {
                this.error = 'It looks like there was an issue with the connection to the server. Please refresh and try again.';
            }
        },

        _handleWsError(e) {
            if (this.role === 'receiver')
                this.error = 'There was an issue connecting to the sender. Please ensure the link is valid and has only been used once.';
            else
                this.error = 'There was an issue connecting to the server. Please refresh the page and try again.';
        },


        /***************************
         * SENDER
         ****************************/

        handleHelloMessage(msg) {
            this.link = location.href + '#' + msg.uuid;
        },

        async handlePubkeyMessage(msg) {
            await this.importPublicKey(msg.key);
            this.isConnected = true;
            this.magicNumbers = msg.magicNumbers;
        },

        handleSdisconnectMessage() {
            if (!this.hasFinished) {
                this.error = 'The sender appears to have disconnected. Please ask the sender for a new link.';
            }
        },

        handleRdisconnectMessage() {
            this.isConnected = false;
        },

        shareLink() {
            if (navigator.share && navigator.userAgent.includes('Mobile')) {
                navigator.share({
                    title: 'securetext.io',
                    url: this.link
                });
            } else {
                let container = document.getElementById('link-container');
                container.classList.add('animate');
                setTimeout(() => {
                    container.classList.remove('animate');
                }, 1000);

                copyToClipboard(this.link);
                this.$refs.message.focus();
            }
        },

        async importPublicKey(key) {
            this.publicKey = await crypto.subtle.importKey(
                'jwk',
                key,
                {
                    name: 'RSA-OAEP',
                    hash: 'SHA-256'
                },
                true,
                ['encrypt']
            );
        },

        verifyReceiver() {
            this.isReceiverVerified = true;
            this.send({ type: 'verification' })
        },

        async sendMessage(e) {
            e.preventDefault();
            this.hasFinished = true;

            const aesKey = await this.generateAESKey();
            const encKeyBuf = await this.encryptAESKey(aesKey);
            const { encryptedMessage: encMsgBuf, iv } = await this.encryptMessage(aesKey, this.messageInput);
            const encKeyB64 = Base64.fromUint8Array(new Uint8Array(encKeyBuf));
            const encMsgB64 = Base64.fromUint8Array(new Uint8Array(encMsgBuf));
            const encIvB64 = Base64.fromUint8Array(new Uint8Array(iv));
            this.send({
                type: 'encmsg',
                key: encKeyB64,
                msg: encMsgB64,
                iv: encIvB64
            });
            this.ws.close();
        },

        async generateAESKey() {
            return await crypto.subtle.generateKey(
                {
                  name: 'AES-GCM',
                  length: 128
                },
                true,
                ['encrypt', 'decrypt']
            );
        },

        async encryptAESKey(key) {
            const keyJwk = await crypto.subtle.exportKey('jwk', key);
            const keyJson = JSON.stringify(keyJwk);
            const encodedKey = this.textEncoder.encode(keyJson);
            return await crypto.subtle.encrypt(
                {
                    name: 'RSA-OAEP'
                },
                this.publicKey,
                encodedKey
            );
        },

        async encryptMessage(key, message) {
            const encodedMessage = this.textEncoder.encode(message);
            const iv = await crypto.getRandomValues(new Uint8Array(12));
            const encryptedMessage = await crypto.subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv: iv
                },
                key,
                encodedMessage
            );
            return { encryptedMessage, iv };
        },

        /***************************
         * RECEIVER
         ****************************/

        async setupReceiver() {
            await this.generateMagicNumbers();
            await this.generateKeyPair();
            const publicKey = await this.getPublicKey();
            this.send({
                type: 'pubkey',
                key: publicKey,
                magicNumbers: this.magicNumbers
            });
            this.isConnected = true;
        },

        async generateMagicNumbers() {
            let magicNumbers = await crypto.getRandomValues(new Uint8Array(3));
            this.magicNumbers = Array.from(magicNumbers)
        },

        async generateKeyPair() {
            this.keyPair = await crypto.subtle.generateKey(
                {
                    name: 'RSA-OAEP',
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: 'SHA-256'
                },
                true,
                ['encrypt', 'decrypt']
            );
        },

        async getPublicKey() {
            return await crypto.subtle.exportKey('jwk', this.keyPair.publicKey);
        },

        async handleEncmsgMessage(msg) {
            this.hasFinished = true;

            const encKeyBuf = Base64.toUint8Array(msg.key);
            const key = await this.decryptAESKey(encKeyBuf);
            const encMsgBuf = Base64.toUint8Array(msg.msg);
            const encIvBuf = Base64.toUint8Array(msg.iv);
            const message = await this.decryptMessage(key, encIvBuf, encMsgBuf)
            this.message = message;
            this.ws.close();
        },

        async decryptAESKey(encKeyBuf) {
            const keyBuf = await crypto.subtle.decrypt(
                {
                    name: 'RSA-OAEP'
                },
                this.keyPair.privateKey,
                encKeyBuf
            );
            const keyJson = this.textDecoder.decode(keyBuf);
            const keyJwk = JSON.parse(keyJson);
            return await crypto.subtle.importKey(
                'jwk',
                keyJwk,
                {
                    name: 'AES-GCM'
                },
                true,
                ['encrypt', 'decrypt']
            );
        },

        async decryptMessage(key, iv, encMsgBuf) {
            const msgBuf = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv
                },
                key,
                encMsgBuf
            );
            const msg = this.textDecoder.decode(msgBuf);
            return msg;
        },

        /***************************
         * HELPERS
         ****************************/

        send(obj) {
            this.ws.send(JSON.stringify(obj));
        },

        showAbout() {
            alert(
                `Hi there! Thanks for checking out securetext.io.\n\n` +
                `This quick & simple web app establishes a connection between a sender and a receiver ` +
                `through a middleman server, hosted for your convenience by Signal24.\n\n` +
                `When a receiver connects to the sender (via the middleman), it generates an asymmetric ` +
                `key pair for RSA encryption. It then forwards the public key to the sender.\n\n` +
                `When the sender clicks the Send button, a 2048-bit AES key is generated by the sender. ` +
                `That key is used to encrypt the message. The AES key is then encrypted using the receiver's public RSA key.\n\n` +
                `Both the encrypted message and the RSA-encrypted AES key are then transmitted to the receiver, ` +
                `at which point the receiver uses its RSA private key to decrypt the AES key, and then in turn, decrypt the message.\n\n` +
                `This provides a convenient end-to-end encrypted method of sending simple text data between a sender and receiver.\n\n` +
                `As an added layer of security, 3 unique numbers are generated by the receiver so that the sender can verify that they are ` +
                `in fact sending to the expected recipient.`
            );
        }
    };
}