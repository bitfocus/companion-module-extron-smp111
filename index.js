var tcp = require('../../tcp');
var instance_skel = require('../../instance_skel');
var TelnetSocket = require('../../telnet');
var debug;
var log;


function instance(system, id, config) {
	var self = this;

	// Request id counter
	self.request_id = 0;
	self.login = false;
	// super-constructor
	instance_skel.apply(this, arguments);
	self.status(1,'Initializing');
	self.actions(); // export actions

	return self;
}

instance.prototype.updateConfig = function(config) {
	var self = this;
	self.config = config;
	self.init_tcp();
};

instance.prototype.incomingData = function(data) {
	var self = this;
	debug(data);

	// Match part of the copyright response from unit when a connection is made.
	if (self.login === false && data.match("Extron Electronics")) {
		self.status(self.STATUS_WARNING,'Logging in');
		self.socket.write("2I"+ "\n"); // Query model description
	}

	if (self.login === false && data.match("Password:")) {
		self.log('error', "expected no password");
		self.status(self.STATUS_ERROR, 'expected no password');
	}

	// Match expected response from unit.
	else if (self.login === false && data.match("Streaming")) {
		self.login = true;
		self.status(self.STATUS_OK);
		debug("logged in");
	}
	// Heatbeat to keep connection alive
	function heartbeat() {
		self.login = false;
		self.status(self.STATUS_WARNING,'Checking Connection');
		self.socket.write("2I"+ "\n"); // should respond with model description eg: "Streaming Media Processor"
		debug("Checking Connection");
		}
	if (self.login === true) {
		clearInterval(self.heartbeat_interval);
		var beat_period = 180; // Seconds
		self.heartbeat_interval = setInterval(heartbeat, beat_period * 1000);
	}
	else {
		debug("data nologin", data);
	}
};

instance.prototype.init = function() {
	var self = this;

	debug = self.debug;
	log = self.log;

	self.init_tcp();
};

instance.prototype.init_tcp = function() {
	var self = this;
	var receivebuffer = '';

	if (self.socket !== undefined) {
		self.socket.destroy();
		delete self.socket;
		self.login = false;
	}

	if (self.config.host) {
		self.socket = new TelnetSocket(self.config.host, 23);

		self.socket.on('status_change', function (status, message) {
			if (status !== self.STATUS_OK) {
				self.status(status, message);
			}
		});

		self.socket.on('error', function (err) {
			debug("Network error", err);
			self.log('error',"Network error: " + err.message);
		});

		self.socket.on('connect', function () {
			debug("Connected");
			self.login = false;
		});

		self.socket.on('error', function (err) {
			debug("Network error", err);
			self.log('error',"Network error: " + err.message);
			self.login = false;
		});

		// if we get any data, display it to stdout
		self.socket.on("data", function(buffer) {
			var indata = buffer.toString("utf8");
			self.incomingData(indata);
		});

		self.socket.on("iac", function(type, info) {
			// tell remote we WONT do anything we're asked to DO
			if (type == 'DO') {
				socket.write(new Buffer([ 255, 252, info ]));
			}

			// tell the remote DONT do whatever they WILL offer
			if (type == 'WILL') {
				socket.write(new Buffer([ 255, 254, info ]));
			}
		});
	}
};


// Return config fields for web config
instance.prototype.config_fields = function () {
	var self = this;

	return [
		{
			type: 'text',
			id: 'info',
			width: 12,
			label: 'Information',
			value: 'This will establish a telnet connection to the SMP 111'
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'SMP IP address',
			width: 12,
			default: '192.168.254.254',
			regex: self.REGEX_IP
		}
	]
};

// When module gets deleted
instance.prototype.destroy = function() {
	var self = this;
	clearInterval (self.heartbeat_interval); //Stop Heartbeat

	if (self.socket !== undefined) {
		self.socket.destroy();
	}

	debug("destroy", self.id);;
};

instance.prototype.actions = function(system) {
	var self = this;
	var actions = {
		'start_rec': {
			label: 'Start recording',
			options: [{
					label: 'start record',
					id: 'start_rec',
			}]
		},
		'stop_rec': {
			label: 'Stop recording',
			options: [{
					label: 'stop record',
					id: 'stop_rec',
			}]
		},
		'pause_rec': {
			label: 'Pause recording',
			options: [{
					label: 'pause record',
					id: 'pause_rec',
			}]
		},
		'mark_rec': {
			label: 'Mark recording',
			options: [{
					label: 'mark record',
					id: 'mark_rec',
			}]
		}
	};

	self.setActions(actions);
}

instance.prototype.action = function(action) {

	var self = this;
	var id = action.action;
	var opt = action.options;
	var cmd;

	switch (id) {
		case 'start_rec':
			cmd = "\x1BY1RCDR";
			break;

		case 'stop_rec':
			cmd = "\x1BY0RCDR";
			break;

		case 'pause_rec':
			cmd = "\x1BY2RCDR";
			break;

		case 'mark_rec':
			cmd = "\x1BBRCDR";
			break;
	}

	if (cmd !== undefined) {
			if (self.tcp !== undefined) {
					debug('sending ', cmd, "to", self.tcp.host);
					self.tcp.send(cmd);
			}
	}

	if (cmd !== undefined) {

		if (self.socket !== undefined && self.socket.connected) {
			self.socket.write(cmd+"\n");
		} else {
			debug('Socket not connected :(');
		}

	}
};

instance_skel.extendedBy(instance);
exports = module.exports = instance;
