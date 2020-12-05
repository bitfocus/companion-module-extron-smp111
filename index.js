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

	self.states = {};
	self.init_feedbacks();
	self.init_variables();
	self.init_tcp();
};

instance.prototype.incomingData = function(data) {
	var self = this;
	debug(data);

	// Match part of the copyright response from unit when a connection is made.
	if (self.login === false && data.match("Extron Electronics")) {
		self.status(self.STATUS_WARNING,'Logging in');
		self.socket.write("\x1B3CV\r"); // Set Verbose mode to 3
		self.socket.write("2I\n"); // Query model description
	}

	if (self.login === false && data.match("Password:")) {
		self.status(self.STATUS_WARNING,'Logging in');
		self.socket.write("\r" +self.config.password+ "\r"); // Enter Password Set
	}

	// Match login sucess response from unit.
	else if (self.login === false && data.match(/Login/)) {
		self.login = true;
		self.socket.write("\x1B3CV\r"); // Set Verbose mode to 3
		self.socket.write("\x1BYRCDR\n"); // Request Record Status
		self.socket.write("\x1BE1RTMP\n"); // Request RTMPStream Status
		self.socket.write("36I\n");
		self.status(self.STATUS_OK);
		debug("logged in");
	}
	// Match expected response from unit.
	else if (self.login === false && data.match(/Streaming/)) {
		self.login = true;
		self.socket.write("\x1BYRCDR\n"); // Request Record Status
		self.socket.write("\x1BE1RTMP\n"); // Request RTMPStream Status
		self.socket.write("36I\n");
		self.status(self.STATUS_OK);
		debug("logged in");
	}
	// Heatbeat to keep connection alive
	function heartbeat() {
		self.login = false;
		self.status(self.STATUS_WARNING,'Checking Connection');
		self.socket.write("2I\n"); // should respond with model description eg: "Streaming Media Processor"
		debug("Checking Connection");
		}
	if (self.login === true) {
		clearInterval(self.heartbeat_interval);
		var beat_period = 5; // Seconds
		self.heartbeat_interval = setInterval(heartbeat, beat_period * 1000);
	}
	// Match recording state change expected response from unit.
	if (self.login === true && data.match(/RcdrY\d+/)) {
		self.states['record_bg'] = parseInt(data.match(/RcdrY(\d+)/)[1]);
		self.checkFeedbacks('record_bg');
		debug("recording change");
		if (self.states['record_bg'] === 2) {
			self.recordStatus = 'Pasued';
		}
		else if (self.states['record_bg'] === 1) {
			self.recordStatus = 'Recording';
		}
		else if (self.states['record_bg'] === 0) {
			self.recordStatus = 'Stopped';
		}
		else {
			self.recordStatus= 'Updating';
		}
		self.setVariable('recordStatus', self.recordStatus);
	}
	else if (self.login === true && data.match(/^Inf36.+/)) {
		self.states['time_remain'] = data.slice(15, -5);
		debug("time change", data);
		self.timeRemain = self.states['time_remain']
		self.setVariable('timeRemain', self.timeRemain);
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
				self.socket.write(Buffer.from([ 255, 252, info ]));
			}

			// tell the remote DONT do whatever they WILL offer
			if (type == 'WILL') {
				self.socket.write(Buffer.from([ 255, 254, info ]));
			}
		});
	}
};

instance.prototype.CHOICES_CHANNEL = [
	{ label: 'RECORD', id: '1' },
	{ label: 'STREAM', id: '2' }
]
instance.prototype.CHOICES_ONOFF = [
	{ label: 'OFF', id: '0' },
	{ label: 'ON', id: '1' }
]
instance.prototype.CHOICES_PRESET = [
	{ label: 'Input preset', id: '2' },
	{ label: 'Stream preset', id: '3' },
	{ label: 'Encoder preset', id: '4' }
]
instance.prototype.CHOICES_RECORD = [
	{ label: 'STOP', id: '0' },
	{ label: 'RECORD', id: '1' },
	{ label: 'PAUSE', id: '2' }
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
		},
		{
			type: 'textinput',
			id: 'password',
			label: 'Admin or User Password',
			width: 8
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

	self.states = {};

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

instance.prototype.init_variables = function () {
	var self = this;
	var variables = [];

	var recordStatus = 'Updating';
	var timeRemain = '00:00';

	variables.push({
		label: 'Current recording status',
		name:  'recordStatus'
	});
	self.setVariable('recordStatus', recordStatus);

	variables.push({
		label: 'Time remaining on recording hh:mm',
		name:  'timeRemain'
	});
	self.setVariable('timeRemain', timeRemain);

	self.setVariableDefinitions(variables);
}

instance.prototype.actions = function(system) {
	var self = this;
	var actions = {
		'recall_ps_input': {
			label: 'Recall a saved input preset',
			options: [{
					label: 'input preset id',
					id: 'ps_type',
					choices: self.CHOICES_PRESET,
					default: '2',
			}, {
				type: 'textinput',
				label: 'input preset',
				id: 'preset',
				regex: self.REGEX_NUMBER
			}]
		},
		'recall_ps_stream': {
			label: 'Recall a saved stream preset',
			options: [{
					label: 'stream preset id',
					id: 'ps_type',
					choices: self.CHOICES_PRESET,
					default: '3',
			}, {
				type: 'textinput',
				label: 'stream preset',
				id: 'preset',
				regex: self.REGEX_NUMBER
			}]
		},
		'recall_ps_encoder': {
			label: 'Recall a saved encoder preset',
			options: [{
					label: 'encoder preset id',
					id: 'ps_type',
					choices: self.CHOICES_PRESET,
					default: '4',
			}, {
				type: 'dropdown',
				label: 'output channel',
				id: 'channel',
				choices: self.CHOICES_CHANNEL,
			}, {
				type: 'textinput',
				label: 'encoder preset',
				id: 'preset',
				regex: self.REGEX_NUMBER
			}]
		},
		'record': {
			label: 'Stop/Record/Pause',
			options: [{
					type: 'dropdown',
					label: 'Action',
					id: 'record_action',
					choices: self.CHOICES_RECORD,
					default: '0',
			}]
		},
		'extend_rec': {
			label: 'Extend recording',
			options: [{
					label: 'Scheduled recordings only',
					id: 'extend_rec',
			}, {
				type: 'textinput',
				label: 'Duration in mins (0 to 60)',
				id: 'duration',
				regex: self.REGEX_NUMBER
			}]
		},
		'mark_rec': {
			label: 'Mark recording',
			options: [{
					label: 'mark record',
					id: 'mark_rec',
			}]
		},
		'rtmp_stream': {
			label: 'RTMP Push Stream On/Off',
			options: [{
					type: 'dropdown',
					label: 'Action',
					id: 'stream_action',
					choices: self.CHOICES_ONOFF,
					default: '0',
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
		case 'recall_ps_input':
			cmd = opt.ps_type+"*"+opt.preset+".";
			break;

		case 'recall_ps_stream':
			cmd = opt.ps_type+"*1*"+opt.preset+".";
			break;

		case 'recall_ps_encoder':
			cmd = opt.ps_type+"*"+opt.channel+"*"+opt.preset+".";
			break;

		case 'record':
			cmd = "\x1BY"+opt.record_action+"RCDR";
			break;

		case 'extend_rec':
			cmd = "\x1BE"+opt.duration+"RCDR";
			break;

		case 'mark_rec':
			cmd = "\x1BBRCDR";
			break;

		case 'rtmp_stream':
			cmd = "\x1BE1*"+opt.stream_action+"RTMP";
			break;

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
