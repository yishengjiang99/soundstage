(function(window) {
	"use strict";

	var assign      = Object.assign;
	var Fn          = window.Fn;
	var AudioObject = window.AudioObject;
	var CueStream   = window.CueStream;
	var CueTimer    = window.CueTimer;

	var defaults = { rate: 2 };

	var createCueTimer = Fn.cache(function createCueTimer(audio) {
		return new CueTimer(function() {
			return audio.currentTime;
		});
	});


	// Clock

	function Clock(audio, events, target) {
		// Support using constructor without the `new` keyword
		if (!Clock.prototype.isPrototypeOf(this)) {
			return new Clock(audio, events);
		}

		var timer = createCueTimer(audio);

		var fns = {
			beatAtTime: function(time) { return time - startTime; },
			timeAtBeat: function(beat) { return startTime + beat; }
		};

		var rateEvent  = [0, 'rate', defaults.rate];
		var meterEvent = [0, 'meter', 4, 1];
		var startTime, stopTime, cuestream;

		// Clock methods basically map CueStream methods, but where a CueStream
		// is read-once clock is persistent and reusable.

		this.start = function(time) {
			startTime = time || audio.currentTime ;

			if (!events[0] || events[0][0] !== 0) {
				events.splice(0, 0, meterEvent);
				events.splice(0, 0, rateEvent);
			}

			cuestream = CueStream(timer, fns, events, Fn.id)
			.each(function(event) { target(event, cuestream); })
			.start(startTime);

			return this;
		};

		this.stop = function(time) {
			stopTime = time || audio.currentTime ;
			cuestream.stop(time || audio.currentTime);
			cuestream = undefined;
			return this;
		};

		this.beatAtTime = function(time) {
			return cuestream ?
				cuestream.beatAtTime(time) :
				0 ;
		};

		this.timeAtBeat = function(beat) {
			return cuestream ?
				cuestream.timeAtBeat(beat) :
				0 ;
		};

		this.create = function(sequence) {
			return CueStream(timer, this, sequence, Fn.id);
		};

		Object.defineProperties(this, {
			state: {
				get: function() {
					return cuestream ? cuestream.state : 'stopped' ;
				},

				// Support get/set observers
				configurable: true
			},

			tempo: {
				get: function() { return this.rate * 60; },
				set: function(tempo) { this.rate = tempo / 60; },
				// Support get/set observers
				configurable: true
			}
		});

		// Set up audio object params
		var unityNode = AudioObject.UnityNode(audio);
		var rateNode  = audio.createGain();

		rateNode.channelCount = 1;
		unityNode.connect(rateNode);

		// Set up clock as an audio object with output and audio property "rate"
		AudioObject.call(this, audio, undefined, {
			rate: rateNode
		}, {
			rate: {
				set: function(value, time, curve, duration) {
					// For the time being, only support step changes to tempo
					if (curve !== 'step') { throw new Error('Clock: currently only supports "step" automations of rate.'); }
					rateNode.gain.setValueAtTime(value, time);
					
					if (cuestream) {
						var e = [clock.beatAtTime(time), 'rate', value];
						cuestream.push(e);
					}
					else {
						rateEvent[2] = value;
					}
				},

				value: 2,
				curve: 'step',
				duration: 0
			}
		});
	}

	Clock.prototype = Object.create(AudioObject.prototype);

	assign(Clock, {
		lookahead: 0.1,
		frameDuration: 0.2
	});

	window.Clock = Clock;
})(this);
