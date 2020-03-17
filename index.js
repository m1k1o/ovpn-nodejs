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
	if(openvpn) {
		throw new Error("Already running!");
	}

	openvpn = spawn('openvpn',  ['--config', path.join(configsPath, configFile)]);
	openvpn.stdout.setEncoding('utf8');
	openvpn.stdout.on('data', function (data) {
		let str = data.toString();
		io.emit("data", { data: str });
		console.log("[OVPN] " + str);
	});
	openvpn.on('close', function (code) {
		openvpn = undefined;
		io.emit("config", {
			config: (config = false)
		});
	});

	io.emit("config", {
		config: (config = configFile)
	});

	SQUID_Stop();
}
function OVPN_Stop() {
	if(!openvpn) {
		throw new Error("Not running!");
	}

	openvpn.stdin.pause();
	openvpn.kill();

	openvpn = undefined;
	io.emit("config", {
		config: (config = false)
	});
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

		return res.json(files);
	});
});
app.post('/connect/:config', (req, res) => {
	try {
		OVPN_Start(req.params.config);

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
app.post('/disconnect', (req, res) => {
	try {
		OVPN_Stop();

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
});

// Default connection
if(process.argv[3]) {
	OVPN_Start(process.argv[3]);
}

// Start Squid
SQUID_Start();

function SQUID_Start() {
	if(squid) return;
	console.log("Starting squid...");

	// Start squid
	squid = spawn('squid',  ['-f', '/etc/squid/squid.conf', '-NYCd', '1']);
	squid.stdout.setEncoding('utf8');
	squid.stdout.on('data', function (data) {
		let str = data.toString();
		console.log("[SQUID] " + str);
	});
	squid.stderr.setEncoding('utf8');
	squid.stderr.on('data', function (data) {
		let str = data.toString();
		console.log("[SQUID] " + str);
	});
	squid.on('close', function (code) {
		console.log("squid exited with code " + code);
		squid = undefined;
		SQUID_Start();
	});
}
function SQUID_Stop() {
	if(!squid) return;
	console.log("Killing squid...");

	squid.stdin.pause();
	squid.kill();

	let interval = setInterval(() => {
		if(squid.killed) {
			squid = undefined;
			console.log("Killed...");
			clearInterval(interval);
		}
	}, 10);
}
