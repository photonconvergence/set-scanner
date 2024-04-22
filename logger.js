var winston= require ( 'winston' );
require ( 'winston-daily-rotate-file' );
const moment = require('moment-timezone');
var fs = require('fs');
const archiver = require('archiver');

if ( process.type === 'browser') // 'browser' means we are in the main process
    var ABS_APP_ROOT = require('electron').app.getAppPath();
else // if not in main process, we must be in the renderer process process.type will then be 'renderer'
    var ABS_APP_ROOT = require ( '@electron/remote' ).app.getAppPath();

ABS_APP_ROOT = ABS_APP_ROOT.replace ( /\/resources\/app.asar|\\resources\\app.asar/, '' ); // If running as electron-builder packaged app
ABS_APP_ROOT = ABS_APP_ROOT.replace ( /\/resources\/app|\\resources\\app/          , '' ); // If running as manually packaged/zip-ed app

if ( !fs.existsSync ( ABS_APP_ROOT + '/log' ) )
	fs.mkdirSync ( ABS_APP_ROOT + '/log' );

const LOG_FILE = ABS_APP_ROOT + '/log/%DATE%logfile.txt';//error: 0, warn: 1, info: 2, verbose: 3, debug: 4, silly: 5

global.ERROR   = 0;
global.WARNING = 1;
global.INFO    = 2;

function getFormattedTimestamp ( withTimezone ) {
	var ts = moment().valueOf()
	var utcOffset = moment().utcOffset()

	if ( withTimezone ) {
		let tmp_str = moment(ts).utcOffset(utcOffset).format('YY-MM-DD HH:mm:ss.SSS UTCZ')
		
		if ( tmp_str.substr ( -3 ) === ':00' )
			tmp_str = tmp_str.substr ( 0, tmp_str.length -3 )

		return tmp_str
	} else
		return moment(ts).utcOffset(utcOffset).format('YY-MM-DD HH:mm:ss.SSS')
}

const wlog = winston.createLogger({
	format: winston.format.combine (
		winston.format.timestamp(),
		winston.format.printf ( info => `${getFormattedTimestamp(true)} [${info.level.toUpperCase()}] ${info.message}`)
	),
	transports: [
		new winston.transports.DailyRotateFile ({
			filename    : LOG_FILE,
			datePattern : 'YYYY-MM-DD_',
			maxFiles    : '30d',
			maxSize     : '20m',
			zippedArchive: true
		})
	]
});

global.log = {}

global.log.info = str => {
    console.log ( getFormattedTimestamp(false), " [INFO] ", str );
    wlog.info ( str );
}

global.log.warn = str => {
	console.warn ( getFormattedTimestamp(false), " [WARNING] ", str );
	wlog.warn ( str );
}

global.log.error = str => {
	console.error ( getFormattedTimestamp(false), " [ERROR] ", str );
	wlog.error ( str );
}

global.zipLogs = (targetPath) => {
	const archive = archiver('zip', { zlib: { level: 9 }});
	const stream = fs.createWriteStream(targetPath);

	return new Promise((resolve, reject) => {
		archive
			.directory(ABS_APP_ROOT + '/log', false)
			.on('error', err => {
				console.error ( getFormattedTimestamp(false), " [ERROR] ", err );
				wlog.error ( err );
				reject(err);
			})
			.pipe(stream);
	
		stream.on('close', () => resolve());
		archive.finalize();
	});
}