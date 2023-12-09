import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage, makeInMemoryStore } from "@whiskeysockets/baileys"
import pino from "pino";
import FileType from "file-type";
import { Boom } from '@hapi/boom';
import fs from "fs";
import PhoneNumber from "awesome-phonenumber";
import { smsg, spinner } from './lib/func.mjs';

const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store'})})

async function starting() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const client = makeWASocket({
        logger: pino({ level: 'silent'}),
        printQRInTerminal: true,
        auth: state
    })
    store.bind(client.ev);

    client.ev.on('messages.upsert', async chatUpdate => {
        try {
            mek = chatUpdate.messages[0]
            if (!mek.message) return
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
            if (mek.key && mek.key.remoteJid === 'status@broadcast') return
            if (!client.public && !mek.key.fromMe && chatUpdate.type === 'notify') return
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return
            if (mek.key.id.startsWith('AdrianDev')) return
            m = smsg(client, m, store)
            require("./client.mjs")(client, m, chatUpdate, store)
        } catch (err) {
            console.log(err)
        }
    })

    client.decodeJid = (jid) => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server && decode.user + '@' + decode.server || jid
        } else return jid
    }
    
    client.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = client.decodeJid(contact.id)
            if (store && store.contacts) store.contacts[id] = {
                id,
                name: contact.notify
            }
        }
    })

    client.getName = (jid, withoutContact = false) => {
        id = client.decodeJid(jid)
        withoutContact = client.withoutContact || withoutContact
        let v
        if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
            v = store.contacts[id] || {}
            if (!(v.name || v.subject)) v = client.groupMetadata(id) || {}
            resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
        })
        else v = id === '0@s.whatsapp.net' ? {
                id,
                name: 'WhatsApp'
            } : id === client.decodeJid(client.user.id) ?
            client.user :
            (store.contacts[id] || {})
        return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
    }

    client.public = false

    client.serializeM = (m) => smsg(client, m, store)

    client.ev.on('connection.update', async (update) => {
        const {
            connection,
            lastDisconnect
        } = update
        try {
            if (connection === 'close') {
                let reason = new Boom(lastDisconnect?.error)?.output.statusCode
                if (reason === DisconnectReason.badSession) {
                    spinner('bad session, harap hapus dan scan kembali');
                    starting()
                } else if (reason === DisconnectReason.connectionClosed) {
                    spinner("koneking hilang, koneking kembali");
                    starting();
                } else if (reason === DisconnectReason.connectionLost) {
                    spinner("koneking terputus dari server, koneking kembali");
                    starting();
                } else if (reason === DisconnectReason.connectionReplaced) {
                    spinner("koneking double, harap matikan salah satunya");
                    starting()
                } else if (reason === DisconnectReason.loggedOut) {
                    spinner(`session telah logout, harap hapus session dan scan kembali`);
                    starting();
                } else if (reason === DisconnectReason.restartRequired) {
                    spinner("dibutuhkan untuk restart, harap restart");
                    starting();
                } else if (reason === DisconnectReason.timedOut) {
                    spinner("koneking telah habis, restart...");
                    starting();
                } else client.end(`error : ${reason}|${connection}`)
            }
            if (update.connection == "connecting" || update.receivedPendingNotifications == "false") {
                console.log(`sedang mengkoneksikan\n`)
            }
            if (update.connection == "open" || update.receivedPendingNotifications == "true") {
                console.log(`sukses konek ke base xyzendev`)
                console.log(`Konek Ke ` + JSON.stringify(client.user, null, 2))
            }

        } catch (err) {
            spinner('Error Di Connection.update ' + err)
            starting();
        }
    })

    client.ev.on('creds.update', saveCreds)
    client.sendImageAsSticker = async (jid, path, quoted, options = {}) => {
        let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,` [1], 'base64') : /^https?:\/\//.test(path) ? await (await getBuffer(path)) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
        let buffer
        if (options && (options.packname || options.author)) {
            buffer = await writeExifImg(buff, options)
        } else {
            buffer = await imageToWebp(buff)
        }

        await client.sendMessage(jid, {
            sticker: {
                url: buffer
            },
            ...options
        }, {
            quoted
        })
        return buffer
    }
    client.sendVideoAsSticker = async (jid, path, quoted, options = {}) => {
        let buff = Buffer.isBuffer(path) ? path : /^data:.*?\/.*?;base64,/i.test(path) ? Buffer.from(path.split`,` [1], 'base64') : /^https?:\/\//.test(path) ? await (await getBuffer(path)) : fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0)
        let buffer
        if (options && (options.packname || options.author)) {
            buffer = await writeExifVid(buff, options)
        } else {
            buffer = await videoToWebp(buff)
        }

        await client.sendMessage(jid, {
            sticker: {
                url: buffer
            },
            ...options
        }, {
            quoted
        })
        return buffer
    }
    client.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
        let quoted = message.msg ? message.msg : message
        let mime = (message.msg || message).mimetype || ''
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
        const stream = await downloadContentFromMessage(quoted, messageType)
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        let type = await FileType.fromBuffer(buffer)
        trueFileName = attachExtension ? (filename + '.' + type.ext) : filename
        await fs.writeFileSync(trueFileName, buffer)
        return trueFileName
    }

    client.downloadMediaMessage = async (message) => {
        let mime = (message.msg || message).mimetype || ''
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
        const stream = await downloadContentFromMessage(message, messageType)
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }

        return buffer
    }
    return client
}

starting();