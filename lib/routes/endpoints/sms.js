const router = require('express').Router();

router.post('/', (req, res) => {
  const {logger} = req.app.locals;
  const {from, text} = req.body;

  logger.debug({payload: req.body}, 'POST /sms');
  try {
    res.sendStatus(200);
    const {meetingTracker} = req.app.locals;
    const meeting = meetingTracker.find(req.body.from);
    if (meeting) {
      meeting.processIncomingSMS(from, text);
    }
  } catch (err) {
    logger.error({err}, 'Error');
  }
});

module.exports = router;
