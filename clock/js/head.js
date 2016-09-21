(function(window) {
	"use strict";

	var assign = Object.assign;
	var defineProperties = Object.defineProperties;

	var Fn               = window.Fn;
	var AudioObject      = window.AudioObject;
	var isAudioContext   = AudioObject.isAudioContext;
	var isDefined        = Fn.isDefined;


	// From clock -------------------------------
	
	function toBeat(time, startTime, data) {
		var b = 0;
		var r = 1;
		var t = 0;

		Fn(data)
		.filter(function(event) { return event[1] === 'rate'; })
		.sort(Fn.by(0))
		.filter(function(event) {
			var temp = t + (event[0] - b) / r;
			if (temp > (time - startTime)) { return false; }
			t = temp;
			return true;
		})
		.each(function(event) {
			b = event[0];
			r = event[2];
		});

		return b + (time - startTime - t) * r;
	}

	function toTime(beat, startTime, data) {
		var b = 0;
		var r = 1;
		var t = 0;

		Fn(data)
		.filter(Fn.compose(Fn.is('rate'), Fn.get(1)))
		.sort(Fn.by(0))
		.filter(function(event) {
			return event[0] < beat;
		})
		.each(function(event) {
			t += (event[0] - b) / r;
			b = event[0];
			r = event[2];
		});

		return startTime + t + (beat - b) /r;
	}


	// ----------------------------------------

	// Event types
	//
	// [time, "note", number, velocity, duration]
	// [time, "noteon", number, velocity]
	// [time, "noteoff", number]
	// [time, "param", name, value, curve]
	// [time, "pitch", semitones]
	// [time, "chord", root, mode, duration]
	// [time, "sequence", data || name, rate, startBeat, duration, address]

	function toNoteOnOffEvent(event) {
		// [time, "note", number, velocity, duration]
		// [time, "noteon", number, velocity]
		// [time, "noteoff", number]
		return event[1] === 'note' ?
			[
				[event[0], 'noteon', event[2], event[3]],
				[event[0] + event[4], 'noteoff', event[2]]
			] :
			[event] ;
	}

	function isTransitionEvent(event) {
		// [time, "param", name, value, curve]
		return event[4] === 'exponential' || event[4] === 'linear';
	}

	var toAbsoluteTimeEvent = Fn.curry(function(head, event) {
		// Convert relative time to absolute time
		var e2 = event.slice();
		e2[0] = head.beatToTime(event[0]);
		return e2;
	});

	function Head(timer, clock, sequence, transform, target) {
		if (!Head.prototype.isPrototypeOf(this)) {
			return new Head(timer, clock, sequence, transform, target);
		}

		var head = this;
		var b0 = 0;
		var heads = [];

		function timeToBeat(time) {
			return toBeat(time, b0, sequence);
		}

		function beatToTime(beat) {
			return toTime(beat, b0, sequence);
		}

		this.now        = Fn.compose(timeToBeat, clock.now);
		this.beatToTime = Fn.compose(clock.beatToTime, beatToTime);
		this.timeToBeat = Fn.compose(timeToBeat, clock.timeToBeat);

		// Horrible. Smelly. Syphon? Is there precedent for this?

		var toAbsoluteTime = toAbsoluteTimeEvent(this);

		var stream = Fn(sequence);

		var rateStream = stream
			.syphon(Fn.pipe(Fn.get(1), Fn.is('rate')));

		var paramStream = stream
			.syphon(Fn.pipe(Fn.get(1), Fn.is('param')))
			.map(transform);

		var eventStream = stream
			//.chain(toNoteOnOffEvent)
			.map(transform)
			.map(toAbsoluteTime);

		this.stream = Fn.Stream(function setup(notify) {
			var eventBuffer  = [];
			var paramBuffer  = [];
			var paramBuffers = [];
			var paramStreams = paramStream
				.group(Fn.get(2))
				.map(function(stream) {
					return stream.map(toAbsoluteTime);
				})
				.toArray();

			var event, params, t1, t2;

			function cue(time) {
				t1 = t2;
				t2 = time;


				// Params

				paramBuffer = paramStreams.map(function(paramStream, i) {
					var param = params[i];
					var buffer = paramBuffers[i] || (paramBuffers[i] = []);

					buffer.length = 0;

					// Cue up all params in the current cue frame
					while (param && t1 <= param[0] && param[0] < t2) {
						if (param.length !== 1) { buffer.push(param); }
						param = paramStream.shift();
					}

					// If the next param is new (param !== params[i]) and is a
					// transitioning param, cue it up now
					if (param && param !== params[i] && isTransitionEvent(param)) {
						buffer.push(param);
						
						// Mark the cached next param as a dummy: it has already
						// been queued, but it needs to be read again in it's
						// own cue frame in order for the next one to be cued...
						param = param.slice();
						param.length = 1;
					}

					params[i] = param;

					return buffer;
				})
				.reduce(Fn.concat, []);


				// Other events

				eventBuffer.length = 0;

				while (event && t1 <= event[0] && event[0] < t2) {
					if (event[1] === 'sequence') {						
						heads.push(new Head(timer, head, event[2], transform, target)
						.start(event[0]));
					}
					else {
						eventBuffer.push(event);
					}

					event = eventStream.shift();
				}

				if (eventBuffer.length || paramBuffer.length) {
					notify('push');
				}

				timer.requestCue(cue);
			}

			return {
				shift: function throttle() {
					var buffer = eventBuffer.concat(paramBuffer);
					if (!buffer.length) { return; }
					var fn = Fn(buffer);
					paramBuffer.length = 0;
					eventBuffer.length = 0;
					return fn;
				},

				start: function(time) {
					t2 = !isDefined(time) ? audio.currentTime : time ;
					b0 = clock.timeToBeat(t2);

					// Seed events
					params = paramStreams.map(function(stream) { return stream.shift(); });
					event = eventStream.shift();
					cue(timer.lastCueTime);
					return this;
				},

				stop: function(time) {
					timer.cancelCue(cue);
					heads.forEach(Fn.invoke('stop', [time]));
					return this;
				}
			};
		})
		.join()
		.each(target);

		this.start      = this.stream.start;
		this.stop       = this.stream.stop;
	}

	Head.prototype = Object.create(Fn.Stream.prototype);

	assign(Head.prototype, {});

	defineProperties(Head.prototype, {});

	assign(Head, {});
	
	window.Head = Head;
})(this);
