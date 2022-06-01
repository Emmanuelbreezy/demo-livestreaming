const io = require('socket.io-client');
const mediasoupClient = require('mediasoup-client');

var urlParams = new URLSearchParams(location.search);
console.log(urlParams,'urlParams')

const roomId = urlParams.get('id');
console.log(roomId)

const socket = io('/mediasoup')

socket.on('connection-success', ({socketId, exitsProducer }) => {
    console.log(socketId,  exitsProducer)
    getLocalStream()
})

//socket.emit("broadcaster", roomId);

// socket.on("broadcaster", (id) => {
//     setBroadcaster(id);
// });

let device;
let rtpCapabilities;
let producerTransport;
//let consumerTransport;
let consumerTransports = [];
let producer;
let consumer;
let isProducer = false;

let params = {
    // mediasoup params
    encodings: [
      {
        rid: 'r0',
        maxBitrate: 100000,
        scalabilityMode: 'S1T3',
      },
      {
        rid: 'r1',
        maxBitrate: 300000,
        scalabilityMode: 'S1T3',
      },
      {
        rid: 'r2',
        maxBitrate: 900000,
        scalabilityMode: 'S1T3',
      },
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
      videoGoogleStartBitrate: 1000
    }
  }
    
const streamSuccess = (stream) => {
    document.getElementById('localVideo').srcObject = stream
    const track = stream.getVideoTracks()[0]
    params = {
        track,
        ...params
    }

   joinRoom();
}


const joinRoom = () => {
    socket.emit('joinRoom', { roomId }, data => {
        console.log(`Router RTP Capabilites... ${data.rtpCapabilities}`);

        rtpCapabilities = data.rtpCapabilities;
        createDevice()
    })
    
}

socket.on('new-producer', ({ producerId }) => signalNewConsumerTransport(producerId))

const getLocalStream =  () => {

    // try{}.catch(error) => {

    // }

        //  navigator.getUserMedia = ( navigator.getUserMedia || 
        //                     navigator.webkitGetUserMedia ||  
        //                     navigator.mozGetUserMedia || 
        //                     navigator.msGetUserMedia);
        navigator.mediaDevices.getUserMedia({
            audio: true,
            video: {
                width: {
                min: 640,
                max: 1920,
                },
                height: {
                min: 400,
                max: 1080,
                }
            }
            })
            .then(streamSuccess)
            .catch(error => {
            console.log(error.message)
            })
    
}

// const goConsume = () => {
//     goConnect(false);
// }

const goConnect = (producer) => {
    isProducer = producer;
    device === undefined  ? getRtpCapabilities() :
    isProducer && createSendTransport()
}

// const goCreateTransport = () => {
//     isProducer ? createSendTransport() : createRecvTransport()
// }


const createDevice = async () => {
    try{
        device = new mediasoupClient.Device()

        await device.load({
            routerRtpCapabilities: rtpCapabilities
        })

        console.log('device RTP Capabilities', rtpCapabilities);

        createSendTransport()

    }catch(error) {
        console.log(error)
        if(error.name === 'UnsupportedError')
            console.warn('browser not supported')
    }
}

const getRtpCapabilities = () => {
    socket.emit('createRoom', (data) => {
        console.log(`Router RTP Capabilities... ${rtpCapabilities}`)
        rtpCapabilities = data.rtpCapabilities;

        //createDevice();
    })

}

const getProducers = () => {
    socket.emit('getProducers', producerIds => {
        producerIds.forEach(id => signalNewConsumerTransport(id));
    })
    //isProducer ? createSendTransport() : createRecvTransport()
}


const createSendTransport = () => {

    socket.emit('createWebRtcTransport', { consumer: false}, ({ params }) => {
        if(params.error){
            console.log(params.error)
            return 
        }

        console.log(params)

        producerTransport = device.createSendTransport(params)

        producerTransport.on('connect', async ({ dtlsParameters}, callback, errback) => {
            try{
                await socket.emit('transport-connect', {
                    //transportId: producerTransport.id,
                    dtlsParameters: dtlsParameters,
                })

                callback()
            }catch(error) {
                errback(error)
            }
        })

        producerTransport.on('produce', async (parameters, callback, errback) => {
            console.log(parameters)

            try{

                await socket.emit('transport-produce', {
                    //transportId: producerTransport.id,
                    kind: parameters.kind,
                    rtpParameters: parameters.rtpParameters,
                    appData: parameters.appData, 

                }, ({ id, produceExit }) => {

                    callback({ id })

                    if(produceExit) getProducers()
                })

            }catch(error){
                errback(reportError)
            }
        })

        connectSendTransport()

    })
}

const connectSendTransport = async () => {
    producer = await producerTransport.produce(params)

    producer.on('trackended', () => {
        console.log('track ended')
    })

    producer.on('transportclose', () => {
        console.log('transport ended')
    })
}



const signalNewConsumerTransport = async (remoteProductId) => {
    
    await socket.emit('createWebRtcTransport', { consumer: true }, ({ params }) => {
        if(params.error){
            console.log(params.error)
            return 
        }

        console.log(params)
        consumerTransport = device.createRecvTransport(params);

        consumerTransport.on('connect', async ({ dtlsParameters}, callback, errback) => {
            try{
                await socket.emit('transport-recv-connect', {
                    //transportId: consumerTransport.id,
                    dtlsParameters: dtlsParameters,
                })

                callback()
            }catch(error) {
                errback(error)
            }
        })

        connectRecvTransport(consumerTransport, remoteProducerId, params.id);
    })
}


const connectRecvTransport = async (consumerTransport, remoteProducerId, serverConsumerTransportId) => {
    await socket.emit('consume', {
        rtpCapabilities: device.rtpCapabilities, 
        remoteProducerId, 
        serverConsumerTransportId
    }, async ({ params }) => {
        if(params.error){
            console.log('Cannot Consume');
            return
        }

        const consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters
        })

        consumerTransports = [
            ...consumerTransports,
            {
                serverConsumerTransportId: params.id,
                producerId: remoteProducerId,
                consumer,
            }
        ]

        const newElem = document.createElement('div');
        newElem.setAttribute('id', `td-${remoteProducerId}`)
        newElem.setAttribute('class','remoteVideo')
        newElem.innerHTML = '<video id="'+ remoteProducerId + '" autoplay class="video"></video>'
        //videoContainer.appendChild(newElem);

        const { track } = consumer;

        console.log(new MediaStream([track]),'Med')

        //document.getElementById('remoteVideo').srcObject = new MediaStream([track])
        document.getElementById(remoteProducerId).srcObject = new MediaStream([track])


        //socket.emit('consumer-resume');
        socket.emit('consumer-resume', {serverConsumerId : params.serverConsumerId});
    })
}

document.getElementById('btnLocalVideo').addEventListener('click', getLocalStream)
//document.getElementById('btnRecvSendTransport').addEventListener('click', goConsume)

socket.on('producer-closed', ({ remoteProducerId }) => {
    const producerToClose = consumerTransports.find(transportData => transportData.producerId === remoteProducerId)
    producerToClose.consumerTransport.close();
    producerToClose.consumer.close();


    consumerTransports = consumerTransports.filter(transportData => transportData.producerId !== remoteProducerId);
    videoContainer.removeChild(document.getElementById(`td-${remoteProducerId}`))
})