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

instance.prototype.init = function() {
	var self = this;

	debug = self.debug;
	log = self.log;

	self.states = {}
	self.init_feedbacks()

	self.init_tcp();
};

instance.prototype.incomingData = function(data) {
	var self = this;
	debug(data);

	// Match part of the copyright response from unit when a connection is made.
	if (self.login === false && data.match("Extron Electronics")) {
		self.status(self.STATUS_WARNING,'Logging in');
		self.socket.write("\x1B3CV"+ "\r"); // Set Verbose mode to 3
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
	// Match recording state change expected response from unit.
	if (self.login === true && data.match(/RcdrY\d+/)) {
		self.states['record_bg'] = parseInt(data.match(/RcdrY(\d+)/)[1]);
		self.checkFeedbacks('record_bg');
		debug("recording change");
		}
	// Match stream state change expected response from unit.
	if (self.login === true && data.match(/RtmpE1\*\d+/)) {
		self.states['rtmp_push_bg'] = parseInt(data.match(/RtmpE1\*(\d+)/)[1]);
		self.checkFeedbacks('rtmp_push_bg');
		debug("stream change");
	}

	else {
		debug("data nologin", data);
	}
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
			self.login = false;
		});

		self.socket.on('connect', function () {
			debug("Connected");
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

instance.prototype.CHOICES_RECORD = [
	{ label: 'STOP', id: '0' },
	{ label: 'START', id: '1' },
	{ label: 'PAUSE', id: '2' }
]

instance.prototype.CHOICES_ONOFF = [
	{ label: 'OFF', id: '0' },
	{ label: 'ON', id: '1'}
]

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

	self.states = {}

	debug("destroy", self.id);
};

instance.prototype.init_feedbacks = function () {
	var self = this
	var feedbacks = {}

	feedbacks['record_bg'] = {
		label: 'Change colors for Record state',
		description: 'If Record state specified is in use, change colors of the bank',
		options: [
			{
				type: 'colorpicker',
				label: 'Foreground color',
				id: 'fg',
				default: self.rgb(255, 255, 255)
			},
			{
				type: 'colorpicker',
				label: 'Background color',
				id: 'bg',
				default: self.rgb(0, 255, 0)
			},
			{
				type: 'dropdown',
				label: 'record',
				id: 'record',
				default: 1,
				choices: self.CHOICES_RECORD
			}
		]
	}

	feedbacks['rtmp_push_bg'] = {
		label: 'Change colors for RTMP Push Options',
		description: 'If RTMP Push Stream in use, change colors of the bank',
		options: [
			{
				type: 'colorpicker',
				label: 'Foreground color',
				id: 'fg',
				default: self.rgb(255, 255, 255)
			},
			{
				type: 'colorpicker',
				label: 'Background color',
				id: 'bg',
				default: self.rgb(0, 255, 0)
			},
			{
				type: 'dropdown',
				label: 'rtmp_push',
				id: 'rtmp_push',
				default: 1,
				choices: self.CHOICES_ONOFF
			}
		]
	}
	self.setFeedbackDefinitions(feedbacks)
}

instance.prototype.feedback = function (feedback, bank) {
	var self = this

	if (feedback.type === 'record_bg') {
		if (self.states['record_bg'] === parseInt(feedback.options.record)) {
			return { color: feedback.options.fg, bgcolor: feedback.options.bg }
		}
	}

	if (feedback.type === 'rtmp_push_bg') {
		if (self.states['rtmp_push_bg'] === parseInt(feedback.options.rtmp_push)) {
			return { color: feedback.options.fg, bgcolor: feedback.options.bg }
		}
	}

	return {}
}

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
		},
		'rtmp_off': {
			label: 'RTMP Off',
			options: [{
					label: 'rtmp off',
					id: 'rtmp_off',
			}]
		},
		'rtmp_on': {
			label: 'RTMP On',
			options: [{
					label: 'rtmp on',
					id: 'rtmp_on',
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

		case 'rtmp_off':
			cmd = "\x1BE1*0RTMP";
			break;

		case 'rtmp_on':
			cmd = "\x1BE1*1RTMP";
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
