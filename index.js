const express = require('express')
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');
const spawn = require('child_process').spawn;
const configsPath = '/vpn/';

// Static files
app.use(express.static(path.join(__dirname, 'static')));

// Control
let squid, openvpn, config;
function OVPN_Start(configFile) {
	return new Promise((res, rej) => {
		if (openvpn) return rej("Already running!");
		console.log("Starting ovpn...");

		// Kill openvpn instance (just in case any exists)
		spawn('killall',  ['-s', 'SIGKILL', 'openvpn']);

		openvpn = spawn('openvpn',  ['--config', path.join(configsPath, configFile)]);
		openvpn.stdout.setEncoding('utf8');
		openvpn.stdout.on('data', function (data) {
			let str = data.toString();
			io.emit("data", { data: str });
			console.log(str);

			// If successfully connected
			if (/Initialization Sequence Completed/.test(str)) {
				io.emit("config", {
					config: (config = configFile)
				});
				SQUID_Restart();
				res();
			}

			// If error happened
			if (/error/i.test(str)) {
				rej(str);
			}
		});
		openvpn.on('close', function (code) {
			console.log("ovpn exited with code " + code);
			openvpn = undefined;
			io.emit("config", {
				config: (config = false)
			});
		});

		setTimeout(() => {
			return rej("Timeout 10s expired...");
		}, 10000);
	});
}
function OVPN_Stop() {
	return new Promise((res, rej) => {
		if (!openvpn) return rej("Not running!");
		console.log("Killing ovpn...");

		openvpn.stdin.pause();
		openvpn.kill('SIGKILL');

		let interval = setInterval(() => {
			if (openvpn.killed) {
				io.emit("config", {
					config: (config = false)
				});
				console.log("Killed...");
				clearInterval(interval);
				openvpn = undefined;
				res();
			}
		}, 10);

		setTimeout(() => {
			return rej("Timeout 10s expired...");
		}, 10000);
	});
}
function SQUID_Start() {
	if (squid) return;
	console.log("Starting squid...");

	// Start squid
	squid = spawn('squid',  ['-f', '/etc/squid/squid.conf', '-NYCd', '1']);
	squid.stdout.setEncoding('utf8');
	squid.stdout.on('data', function (data) {
		let str = data.toString();
		console.log(str);
	});
	squid.stderr.setEncoding('utf8');
	squid.stderr.on('data', function (data) {
		let str = data.toString();
		console.log(str);
	});
	squid.on('close', function (code) {
		console.log("squid exited with code " + code);
		squid = undefined;

		// On normal stop restart
		if (code == 0) {
			SQUID_Start();
		}
	});
}
function SQUID_Restart() {
	if (!squid) {
		SQUID_Start();
		return ;
	}
	console.log("Killing squid...");

	squid.stdin.pause();
	squid.kill('SIGINT');

	let interval = setInterval(() => {
		if (squid.killed) {
			console.log("Killed...");
			clearInterval(interval);
			squid = undefined;
		}
	}, 10);
}

// Socket control
io.on('connection', function(socket) {
	console.log('New connection!');

	socket.on('config', () => {
		socket.emit("config", { config });
	});
});

// Get Configs
app.get('/configs', (req, res) => {
	fs.readdir(configsPath, function (err, files) {
		if (err) {
			return res.json({
				notif: 'warn',
				title: 'Unable to scan directory.',
				content: err
			});
		}

		// Only files ending with `.conf` or `.ovpn`.
		files = files.filter(file => /\.(ovpn|conf)$/.test(file));
		return res.json(files);
	});
});
app.post('/connect/:config', async (req, res) => {
	try {
		await OVPN_Start(req.params.config);

		return res.json({
			notif: 'success',
			title: 'Succesful connection!',
			content: 'Succesfuly connected to '+req.params.config
		});
	} catch(e) {
		return res.json({
			notif: 'error',
			title: 'Error while connecting!',
			content: e.message
		});
	}
});
app.post('/disconnect', async (req, res) => {
	try {
		await OVPN_Stop();

		return res.json({
			notif: 'success',
			title: 'Disconnected!'
		});
	} catch(e) {
		return res.json({
			notif: 'error',
			title: 'Error while disconnecting!',
			content: e.message
		});
	}
});

// Bind port
let port = process.argv[2] || 80;
http.listen(port, function(){
	console.log('listening on *:' + port);

	// Default connection
	if (process.argv[3]) {
		OVPN_Start(process.argv[3]);
	} else {
		SQUID_Start();
	}
});
