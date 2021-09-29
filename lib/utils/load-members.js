const { GoogleSpreadsheet } = require('google-spreadsheet');
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
let sheet;

module.exports = async(logger) => {
  const loadMembers = async() => {
    const gcreds = process.env.GOOGLE_SHEET_CREDENTIALS_FILE;
    const path = gcreds.startsWith('/') ? gcreds : `${__dirname}/../${gcreds}`;
    await doc.useServiceAccountAuth(require(path));
    await doc.loadInfo();
    sheet = await doc.sheetsByIndex[0];
    const rows = await sheet.getRows();
    const members = rows.map((row) => {
      const [name, alt, tn] = row._rawData;
      logger.debug({name, alt, tn}, 'row');
      const hints = alt
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((el) => el.length);
      return {
        name,
        hints: hints.concat(name.toLowerCase()),
        tn
      };
    });
    return members;
  };

  try {
    return await loadMembers(logger);
  } catch (err) {
    logger.error({err}, 'Error loading members from shared google sheet');
  }
};

