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
let openvpn, config;
function OVPN_Start(configFile) {
	if(openvpn) {
		throw new Error("Already running!");
	}

	openvpn = spawn('openvpn',  ['--config', path.join(configsPath, configFile)]);
	openvpn.stdout.setEncoding('utf8');
	openvpn.stdout.on('data', function (data) {
		let str = data.toString();
		io.emit("data", { data: str });
		console.log(str);
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
