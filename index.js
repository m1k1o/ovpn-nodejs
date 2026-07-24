const express = require('express')
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const configsPath = '/vpn/';

// Static files
app.use(express.static(path.join(__dirname, 'static')));

// Control
let squid, openvpn, config;
function OVPN_Start(configFile) {
        return new Promise((res, rej) => {
                if (openvpn) return rej("OpenVPN already running!");
                console.log("Starting ovpn with config: ", configFile);

                // Kill openvpn instance (just in case any exists)
                try { execSync('pkill openvpn'); } catch (e) {}

                let timer;
                let isConnected = false;

                openvpn = spawn('openvpn', ['--config', path.join(configsPath, path.basename(configFile))]);
                openvpn.stdout.setEncoding('utf8');
                openvpn.stdout.on('data', function (data) {
                        let str = data.toString();
                        io.emit("data", { data: str });
                        console.log(str);

                        // If successfully connected
                        if (/Initialization Sequence Completed/.test(str)) {
                                isConnected = true;
                                io.emit("config", {
                                        config: (config = configFile)
                                });
                                SQUID_Restart();
                                clearTimeout(timer);
                                res();
                        }

                        // If error happened
                        if (/error/i.test(str) && !isConnected) {
                                clearTimeout(timer);
                                if (openvpn) {
                                        openvpn.kill('SIGTERM');
                                        openvpn = undefined;
                                }
                                rej(str);
                        }
                });
                openvpn.on('close', function (code) {
                        console.log("OpenVPN exited with code " + code);
                        openvpn = undefined;
                        io.emit("config", {
                                config: (config = false)
                        });
                        clearTimeout(timer);
                        if (!isConnected) {
                                rej("OpenVPN exited with code " + code);
                        }
                });

                timer = setTimeout(() => {
                        openvpn = undefined;
                        try {
                                execSync('pkill -9 openvpn');
                        } catch (e) {
                        }
                        return rej("Timeout 10s expired...");
                }, 10000);
        });
}
function OVPN_Stop() {
        return new Promise((res, rej) => {
                if (!openvpn) return rej("Not running!");
                console.log("Killing OpenVPN...");

                const timer = setTimeout(() => {
                        try { execSync('pkill -9 openvpn'); } catch (e) {}
                        rej(new Error("Timeout 10s expired while stopping OpenVPN..."));
                }, 10000);

                openvpn.once('close', () => {
                        clearTimeout(timer);
                        openvpn = undefined;
                        config = false;
                        io.emit("config", { config });
                        console.log("OpenVPN killed successfully.");
                        res();
                });

                openvpn.stdin.pause();
                openvpn.kill('SIGTERM');
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
        });
}
function SQUID_Restart() {
        if (!squid) {
                SQUID_Start();
                return ;
        }
        console.log("Killing squid...");

        const timer = setTimeout(() => {
                try { execSync('pkill -9 squid'); } catch (e) {}
                console.error("Timeout 10s expired while stopping squid...");
                SQUID_Start();
        }, 10000);

        squid.once('close', () => {
                clearTimeout(timer);
                console.log("Old squid killed. Starting new instance...");
                SQUID_Start();
        });

        squid.stdin.pause();
        squid.kill('SIGINT');
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

                const file_regexp = (process.env.FILE_REGEXP && new RegExp(process.env.FILE_REGEXP)) || /\.(ovpn|conf)$/;
                const file_group = (file) => {
                        if(!process.env.GROUP_REGEXP) return '';

                        const m = file.match(new RegExp(process.env.GROUP_REGEXP));
                        if(m) {
                                return m[1];
                        }

                        return '';
                };

                return res.json(files
                        .filter(file =>
                                file_regexp.test(file))
                        .map(file =>
                                ({
                                        name: file.replace(file_regexp, ''),
                                        group: file_group(file),
                                        file
                                })));
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
                        content: e.message || e.toString()
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
                        content: e.message || e.toString()
                });
        }
});

// Bind port
let port = process.argv[2] || 80;
http.listen(port, async function() {
        console.log('listening on *:' + port);

        // Default connection
        if (process.argv[3]) {
                let max_tries = 3;
                const timeout = 1000;

                while(max_tries-- > 0) {
                        try {
                                await OVPN_Start(process.argv[3]);
                                break;
                        } catch (e) {
                                await new Promise((res, rej) =>
                                        setTimeout(res, timeout));
                        }
                }

                return;
        }

        SQUID_Start();
});
