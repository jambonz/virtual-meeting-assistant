const router = require('express').Router();

router.use('/call-status', require('./call-status'));
router.use('/listen', require('./listen'));
router.use('/sms', require('./sms'));

module.exports = router;
