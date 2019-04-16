/*
Control(audio, distribute)

Constructor for muteable objects that represent a route from a source stream
through a selectable transform function to a target stream.

```
{
    source: {
        port:    'id',
        channel: 1,
        type:    'control',
        param:   1
        value:   undefined
    },

    transform: 'linear',
    min: 0,
    max: 1,
    type: 'control',
    param: 'pitch',

    target: {
        id:
        type:
        object:
    }
}
```

*/

import { id, noop, Privates, remove }     from '../../fn/module.js';
import { numberToFrequency }     from '../../midi/module.js';
import { Distribute } from './distribute.js';

const DEBUG  = window.DEBUG;

const assign = Object.assign;
const seal   = Object.seal;

export const types = {
    'note':    function control(type, name, value) {
        return value ? 'noteon' : 'noteoff' ;
    },

    'control': function control(type) {
        return 'param';
    },

    'all': id
};

export const denormalisers = {
    'pass': function linear(min, max, n, current) {
        return n;
    },

    'linear': function linear(min, max, n, current) {
        return n * (max - min) + min;
    },

    'quadratic': function quadratic(min, max, n, current) {
        return Math.pow(n, 2) * (max - min) + min;
    },

    'cubic': function pow3(min, max, n, current) {
        return Math.pow(n, 3) * (max - min) + min;
    },

    'logarithmic': function log(min, max, n, current) {
        return min * Math.pow(max / min, n);
    },

    'frequency': function toggle(min, max, n, current) {
        return (numberToFrequency(n) - min) * (max - min) / numberToFrequency(127) + min ;
    },

    'toggle': function toggle(min, max, n, current) {
        if (n > 0) {
            return current <= min ? max : min ;
        }
    },

    'switch': function sw(min, max, n, current) {
        return n < 0.5 ? min : max ;
    },

    'continuous': function toggle(min, max, n, current) {
        return current + 64 - n ;
    }
};

function getControlLatency(stamps, context) {
    // In order to play back live controls without jitter we must add
    // a latency to them to push them beyond currentTime.
    // AudioContext.outputLatency is not yet implemented so we need to
    // make a rough guess. Here we track the difference between contextTime
    // and currentTime, ceil to the nearest 32-sample block and use that –
    // until we detect a greater value.

    const contextTime = stamps.contextTime;
    const currentTime = context.currentTime;

    if (context.controlLatency === undefined || currentTime - contextTime > context.controlLatency) {
        const diffTime = currentTime - contextTime;
        const blockTime = 32 / context.sampleRate;

        // Cache controlLatency on the context as a stop-gap measure
        context.controlLatency = Math.ceil(diffTime / blockTime) * blockTime;

        // Let's keep tabs on how often this happens
        console.log('Control latency changed to ' + Math.round(context.controlLatency * context.sampleRate) + ' sample frames (' + context.controlLatency.toFixed(3) + 's @ ' + context.sampleRate + 'Hz)');
    }

    return context.controlLatency;
}

function timeAtDomTime(stamps, domTime) {
    return stamps.contextTime + (domTime - stamps.performanceTime) / 1000;
}

function getControlTime(context, domTime) {
    const stamps         = context.getOutputTimestamp();
    const controlLatency = getControlLatency(stamps, context);
    const time           = timeAtDomTime(stamps, domTime);
    return time + controlLatency;
}

function getContextTime(context, domTime) {
    const stamps = context.getOutputTimestamp();
    return timeAtDomTime(stamps, domTime);
}

export default function Control(controls, source, target, settings, notify) {
    const data = {
        type:      settings.type,
        name:      settings.name,
        transform: settings.transform || 'linear',
        min:       settings.min || 0,
        max:       settings.max || 1,
        latencyCompensation: settings.latencyCompensation === undefined ?
            true :
            settings.latencyCompensation
    };

    const privates = Privates(this);
    const taps = privates.taps = [];

    privates.notify = notify || noop;

    this.controls = controls;
    this.source   = source;
    this.target   = target;
    this.data     = data;

    seal(this);

    const distribute = Distribute(target.data, privates.notify);

    // Keep track of value, it is passed back into transfoms to enable
    // continuous controls
    var value;

    // Bind source output to route input
    source.each(function input(timeStamp, type, name, n) {
        // Catch keys with no name
        if (!name && !data.name) { return; }

        const context = target.data.context;
        let time = data.latencyCompensation ?
            getControlTime(context, timeStamp) :
            getContextTime(context, timeStamp) ;

        if (time < context.currentTime) {
            if (DEBUG) { console.log('Soundstage jitter warning. Control time (' + time + ') less than currentTime (' + context.currentTime + '). Using currentTime.'); }
            time = context.currentTime;
        }

        // Set type, name, value based on data
        type = data.type ?
            types[data.type] ?
                types[data.type](type, name, n) :
                data.type :
            type ;

        name = data.name ?
            data.name[name] :
            name ;

        value = denormalisers[data.transform] ?
            denormalisers[data.transform](data.min, data.max, n, value) :
            n ;

        distribute(time, type, name, value);

        // Call taps
        var m = taps.length;
        while (m--) {
            taps[m](time, type, name, value);
        }

        if (target.record) {
            if (!target.recordDestination) {
                if (!target.recordCount) {
                    target.recordCount = 0;
                }

                const data = {
                    id: target.id + '-take-' + (target.recordCount++),
                    events: []
                };

                target.recordDestination = (new Sequence(target.graph, data)).start(time);
                target.graph.sequences.push(data);
                target.graph.record(time, 'sequence', data.id, target.id);
            }

            target.recordDestination.record(time, type, name, value);
        }
    });
}

assign(Control.prototype, {
    tap: function(fn) {
        Privates(this).taps.push(fn);
        return this;
    },

    remove: function() {
        this.source.stop();
        remove(this.controls, this);
        Privates(this).notify(this.controls, '.');
    },

    toJSON: function() {
        return {
            source: this.source,
            target: this.target.id,
            data:   this.data
        };
    }
});
