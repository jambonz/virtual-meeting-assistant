const Symbolai = require('./symbolai');


module.exports = (logger, app, socket) => {
  const {meetingTracker} = app.locals;
  let connected = false;
  let metadata;
  const symbolai = new Symbolai(logger, app);
  symbolai.on('connect', () => connected = true);

  socket
    .on('message', (data, isBinary) => {
      if (!metadata && !isBinary) {
        metadata = JSON.parse(data.toString());
        const {callSid} = metadata;
        symbolai.connect(callSid);
        meetingTracker.add(symbolai);
      }
      else if (isBinary) {
        if (connected) symbolai.sendAudio(Buffer.from(data, 'base64'));
      }
      else {
        const metadata = JSON.parse(data.toString());
        logger.debug({metadata}, 'got metadata over listen socket');
      }
    })
    .on('close', () => {
      logger.info('listen socket closed by jambonz');
      if (symbolai) symbolai.close();
      connected = false;
    });
};
