import express from 'express';
const app = express()

import https from 'httpolyglot';
import fs from 'fs';
import path from 'path';
import mediasoup from 'mediasoup';

const __dirname  =  path.resolve()

import { Server } from 'socket.io';

app.get('*', (req,res, next) => {
    const path = '/sfu/';
    if(req.path.indexOf(path) == 0 && req.path.length > path.length) return next()
    res.send('Hello from mediasoup')
})

app.use('/sfu/:room', express.static(path.join(__dirname, 'public')))

const options = {
    key: fs.readFileSync('./server/ssl/key.pem', 'utf-8'),
    cert: fs.readFileSync('./server/ssl/cert.pem', 'utf-8')
}

const httpsServer = https.createServer(options, app)
httpsServer.listen(3000, () => {
    console.log('listening on port: ' + 3000)
})
 
const io =  new Server(httpsServer)

const connections = io.of('/mediasoup')

// let worker;
// let router
// let producerTransport
// let consumerTransport
// let producer
// let consumer
const PUBLISHER_PEER = 'publisher';

let worker
let rooms = {}          // { roomName1: { Router, rooms: [ sicketId1, ... ] }, ...}
let peers = {}          // { socketId1: { roomName1, socket, transports = [id1, id2,] }, producers = [id1, id2,] }, consumers = [id1, id2,], peerDetails }, ...}
let transports = []     // [ { socketId1, roomName1, transport, consumer }, ... ]
let producers = []      // [ { socketId1, roomName1, producer, }, ... ]
let consumers = []      // [ { socketId1, roomName1, consumer, }, ... ]



const createWorker = async () => {
    worker = await mediasoup.createWorker({
        rtcMinPort: 2000,
        rtcMaxPort: 2020
    })

    console.log(`worker pid ${worker.pid}`)

    worker.on('died', error => {
        console.log('mediasoup worker has died')
        setTimeout(() => process.exit(1), 2000)
    })

    return worker;

}

worker = createWorker();

const mediaCodecs = [

    {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
    },
    {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
            'x-google-start-bitrate': 1000,
        },

    }
]

connections.on('connection', async socket => {

    socket.emit('connection-success', { 
        socketId: socket.id,
        exitsProducer: producer ? true : false
    })

    socket.on('disconnect', () => {
        console.log('peer disconnected');
    })


    socket.on('joinRoom', async ({ roomName}, callback) => {
        const router1 = await createRoom(roomName, socket.id)

        peers[socket.id] = {
            socket,
            roomName,
            transports: [],
            producers: [],
            consumers: [],
            peerDetails: {
                name: '',
                isAdmin: false,
            }
        }

        const rtpCapabilities = router1.rtpCapabilities

        callback({ rtpCapabilities })
    })

    const createRoom = async (roomName, socketId) => {
        let router1;
        let peers = [];
        if(rooms[roomName]) {
            router1 = rooms[roomName].peers || []
        }else{
            router1 = await worker.createRouter({ mediaCodecs, })
        }

        console.log(`Router ID: ${router1.id}`, peers.length)

        rooms[roomName] = {
            router: router1,
            peers: [...peers, socketId],
        }

        return router1;
    }

    // socket.on('createRoom', async (callback) => {
    //     if (router === undefined) {
    //       // worker.createRouter(options)
    //       // options = { mediaCodecs, appData }
    //       // mediaCodecs -> defined above
    //       // appData -> custom application data - we are not supplying any
    //       // none of the two are required
    //       router = await worker.createRouter({ mediaCodecs, })
    //       console.log(`Router ID: ${router.id}`)
    //     }
    
    //     getRtpCapabilities(callback)
    //   })
    
    //   const getRtpCapabilities = (callback) => {
    //     const rtpCapabilities = router.rtpCapabilities
    
    //     callback({ rtpCapabilities })
    //   }

    socket.on('createWebRtcTransport', async ({ consumer }, callback) => {
        console.log(`Is this a sender request? ${consumer}`)

        createWebRtcTransport(router).then(
            transport => {
                callback({
                    params:{
                        id: transport.id,
                        iceCandidates: transport.iceParameters,
                        iceParameters: transport.iceCandidates,
                        dtlsParameters: transport.dtlsParameters,
                    }
                })

                addTransport(transport, roomName, consumer)
            },
            error => {
                console.log(error)
            }
        )
        // if(sender)
        //     producerTransport = await createWebRtcTransport(callback) 
        // else
        //     consumerTransport = await createWebRtcTransport(callback)
    })

    const addTransport = (transport, roomName, consumer) => {

        transports = [
            ...transports,
            { socketId: socket.id, transport, roomName, consumer, }
        ]

        peers[socket.id] = {
            ...peers[socket.id],
            transports:[
                ...peers[socket.id].transports,
                transport.id
            ]
        }
    }



    socket.on('transport-connect', async ({ dtlsParameters }) => {
        console.log('DTLS PARAMS...', { dtlsParameters})
        await producerTransport.connect({ dtlsParameters})
    })

    socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
       producer = await producerTransport.produce({
           kind,
           rtpParameters,
       })

       console.log('ProducerID: ', producer.id, producer.kind)

       producer.on('transportclose', () => {
           console.log('transport for this producer closed')
           producer.close()
       })

       callback({
           id: producer.id
       })
    })

    socket.on('transport-recv-connect', async ({ dtlsParameters }) => {
        console.log('DTLS PARAMS...', { dtlsParameters})
        await consumerTransport.connect({ dtlsParameters})
    })


    socket.on('consume', async({ rtpCapabilities }, callback) => {
        try{

            if(router.canConsume({
                producerId: producer.id,
                rtpCapabilities
            })){

                consumer = await consumerTransport.consume({
                    producerId: producer.id,
                    rtpCapabilities,
                    paused: true
                })

                consumer.on('transportclose', () => {
                    console.log('transport close from consumer')
                })

                consumer.on('producerclose', () => {
                    console.log('producer of consumer closed')
                })

                const params = {
                    id: consumer.id,
                    producerId: producer.id,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                  }
          
                  // send the parameters to the client
                  callback({ params })
            }
            
        } catch(error) {
            console.log(error.message)
            callback({
                params: {
                    error: error
                }
            })
        }
    })

    socket.on('consumer-resume', async () => {
        console.log('consumer resume')
        await consumer.resume()
      })



})


const createWebRtcTransport = async (router) => {
    return new Promise(async (resolve, reject) => {
        try{
    
            const webRtcTransport_options = {
                listenIps: [
                  {
                    ip: "0.0.0.0", // replace with relevant IP address
                    announcedIp: "127.0.0.1",
                  }
                ],
                enableUdp: true,
                enableTcp: true,
                preferUdp: true,
                maxIncomingBitrate: 1500000,
                initialAvailableOutgoingBitrate: 1000000,
              }
          
              
            let transport = await router.createWebRtcTransport(webRtcTransport_options)
            console.log(`transport id: ${transport.id}`)
    
            transport.on('dtlsstatechange', dtlsState => {
                if(dtlsState === 'closed'){
                    transport.close()
                }
            })
    
            transport.on('close', () => {
                console.log('transport closed')
            })
    
         
    
            resolve(transport);
    
        }catch (error) {
           reject(error)
        }

    })
}


