
/**
Envelope(context, settings)

```js
const envelope = stage.createNode('envelope', {
    // An array of param events describing a attack curve
    attack: [
        [0.01, 'linear', 1]
    ],

    // An array of param events describing a release curve
    release: [
        [0, 'target', 0, 0.2]
    ],

    gain: 1,
    rate: 1
});
```

<p class="warn">
Take care not to connect an envelope directly to your outputs – expecially if you have expensive speakers attached.
They are capable of producing DC signal.
</p>
**/

import PlayNode from './play-node.js';
import { automate, getValueAtTime, validateParamEvent } from '../modules/automate.js';
import config from '../config.js';
import { assignSettingz__ } from '../modules/assign-settings.js';

const assign = Object.assign;
const define = Object.defineProperties;
const getDefinition = Object.getOwnPropertyDescriptor;

// Time multiplier to wait before we accept target value has 'arrived'
const targetDurationFactor = config.targetDurationFactor;

const properties = {
    /** .attack
    An array of param events describing an arbitrary attack curve for the
    envelope. Param events have the form [time, type, value] (or if type is
    `'target'`, [time, type, value, duration]), where `time` is the time since
    the time passed to `.start(time)`.

    The default envelope value at time `0` is `0`.
    **/

    attack:  { writable: true, enumerable: true },

    /** .release
    An array of param events describing the release curve of the envelope. Param
    events have the form [time, type, value] (or if type is `'target'`
    [time, type, value, duration]), where `time` is the time since the time
    passed to `.stop(time)`.

    Values are scaled to the current value of the envelope – if the attack
    envelope decays to a value of `0.5`, say, by the scheduled stop time, all
    values in the release envelope are multiplied by `0.5`. The last event
    should have a value of `0`, otherwise the envelope will never stop.
    **/

    release: { writable: true, enumerable: true },

    /** .gain
    A float, nominally in the rage `0–1`, that is read on `.start()` to
    determine the gain to apply to the curve.
    **/

    gain:    { writable: true, enumerable: true },

    /** .rate
    A float that is read on `.start()` or `.stop()` to determine the rate of
    playback to apply to the curve.
    **/

    rate:    { writable: true, enumerable: true }
};

const defaults = {
    attack: [
        [0.008, 'linear', 1]
    ],

    release: [
        [0.008, 'linear', 0]
    ],

    offset: 0,
    gain: 1,
    rate: 1
};

function cueAutomation(param, events, time, gain, rate) {
    var event;
    automate(param, time, 'hold');

    for (event of events) {
        validateParamEvent(event);

        // param, time, curve, value, decay
        automate(param, time + event[0] / rate, event[1], event[2] * gain, event[3]);
    }
}

export default class Envelope extends ConstantSourceNode {
    constructor(context, settings) {
        super(context);
        super.start.call(this, context.currentTime);

        // Define .start(), .stop(), .startTime and .stopTime
        PlayNode.call(this, context);

        // Properties
        define(this, properties);

        // Set properties and params
        assignSettingz__(this, assign({}, defaults, settings));
    }

    /** .start(time)

    Start playback of envelope at `time`.

    Returns `this`.
    **/

    start(time) {
        if (!this.attack) { return this; }
        PlayNode.prototype.start.apply(this, arguments);
        cueAutomation(this.offset, this.attack, this.startTime, this.gain, this.rate, 'ConstantSource.offset');
        return this;
    }

    /** .stop(time)

    Stop playback of envelope at `time`.

    Returns `this`.
    **/

    stop(time) {
        if (!this.release) { return this; }
        PlayNode.prototype.stop.apply(this, arguments);

        // Use the current signal as the start gain of the release
        const gain = getValueAtTime(this.offset, this.stopTime);
        cueAutomation(this.offset, this.release, this.stopTime, gain, this.rate, 'ConstantSource.offset');

        // Update stopTime to include release tail
        const last = this.release[this.release.length - 1];
        if (last[2] !== 0) {
            console.warn('Envelope.release does not end with value 0. Envelope will never stop.', this);
            this.stopTime = Infinity;
        }
        else {
            this.stopTime += last[1] === 'target' ?
                last[0] + last[3] * targetDurationFactor :
                last[0] ;
        }

        return this;
    }
}

define(Envelope.prototype, {
    playing: getDefinition(PlayNode.prototype, 'playing')
});
