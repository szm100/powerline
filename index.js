//import the regression-js library
//requires installation of the regression-js library into node_modules folder
//npm install --save regression
regression = require('../IF/plugin/node_modules/regression')

//global variables
//the batch size to be processed
//for best results, it should be set to 5
let group_size = 5
//0-100 sensitivity number, the lower, the more sensitive
let anomaly_sensitivity = 20
//the number of timestamps that each current timestamp should be expanded to, excluding first element, including last element
let no_ts = 5

const Interpolate = (globalConfig) => {

    const metadata = {
        kind: 'execute',
    };

    const execute = async (inputs, config) => {

        //batch the input into multiple groups for output processing
        no_groups = ((inputs.length / group_size) | 0) + 1
        last_group_size = inputs.length - ((no_groups-1) * group_size)
        outputs = []

        //main data processing
        for (let i = 0; i < no_groups; i++){

            //pre-processing batching
            iter_count = group_size
            if (i == (no_groups-1)) iter_count = last_group_size
            start = i * group_size
            np = []
            for (let j = start; j < start+iter_count; j++){
                np.push(JSON.parse(JSON.stringify(inputs[j])))
            }

            //process data
            processed = process_timestamp_data(np)

            //output processed data
            for (let j = 0; j < processed.length; j++){
                outputs.push(JSON.parse(JSON.stringify(processed[j])))
            }
            
        }

        return outputs
    };

    //process each batch of data using a pipeline of functions
    function process_timestamp_data(pre){

        stage1 = remove_anomalies(pre)
        stage2 = increase_timestamps(stage1)
        stage3 = polynomial_processing(stage2)
        return stage3

    }

    //removes any large spikes in the data
    function remove_anomalies(inp){

        //processing for small batches of data
        if (inp.length < 3){
            return inp
        }

        //for each intermediate timestamp, regulate the timestamp if it is too far above neighbouring timestamps
        for (let i = 1; i < (inp.length-1); i++){

            //get the neighbouring timestamps
            prev = inp[i-1]['cpu/utilization']
            current = inp[i]['cpu/utilization']
            next = inp[i+1]['cpu/utilization']
            //check neighbouring values
            lower = Math.min(prev,next)
            higher = Math.max(prev,next)
            //if this value is much lower or higher than both values, then normalize it
            if(current < (lower-anomaly_sensitivity) || current > (higher+anomaly_sensitivity)){
                
                reasonable_value = (prev+next)/2
                //replace value
                inp[i]['cpu/utilization'] = reasonable_value

            }
            
        }

        return inp

    }

    //creates more data timestamps for polynomial processing
    function increase_timestamps(inp){

        //processing for small batches of data
        if (inp.length < 2){
            return inp
        }

        //output array
        outp = []

        //for every data timestamp except the last
        for (let i = 0; i < (inp.length-1); i++){

            //new interval length
            new_interval_length = inp[i]['duration'] / no_ts

            //add old timestamp to output, with corrected interval length
            outp.push(JSON.parse(JSON.stringify(inp[i])))
            outp[outp.length-1]['duration'] = new_interval_length

            //for every new timestamp to add
            for (let j = 1; j < no_ts; j++){
                outp.push(JSON.parse(JSON.stringify(inp[i])))
                outp[outp.length-1]['duration'] = new_interval_length
            }

        }
        
        //include last timestamp
        outp.push(JSON.parse(JSON.stringify(inp[inp.length-1])))
        return outp

    }

    //feed values into polynomial regression library, and obtain new output
    function polynomial_processing(inp){

        //absolute time represents the x-axis of the polynomial regression
        absolute_time = []
        abs_time_ctr = 0

        //util represents the y-axis of the polynomial regression
        util = []

        //getting absolute time values and util values from the data
        for (let i = 0; i < (inp.length-1); i += no_ts){

            absolute_time.push((abs_time_ctr/100))
            abs_time_ctr += (no_ts*inp[i]['duration'])
            util.push(inp[i]['cpu/utilization'])

        }

        //append the last value
        absolute_time.push((abs_time_ctr/100))
        util.push(inp[inp.length-1]['cpu/utilization'])

        //process data in x-y form for regression
        x_y = []
        for (let i = 0; i < absolute_time.length; i++){
            x_y.push([absolute_time[i],util[i]])
        }

        //obtain the parameters from the polynomial regression model
        //the implementation is dependent on the size of the x_y array
        if (x_y.length < 3){
            result = regression.linear(x_y)
        }
        else if (x_y.length < 4){
            result = regression.polynomial(x_y, {order: 2})
        }
        else{
            result = regression.polynomial(x_y, {order: 3})
        }

        outp = []

        //uses the coefficients and the absolute time to replace the utilization data in x
        abs_time_ctr = 0

        for (let i = 0; i < inp.length; i++){
            //get predicted value to fill in
            predicted_util = calculatePolynomial(result.equation,(abs_time_ctr/100))
            predicted_util = Math.max(predicted_util,0)
            predicted_util = Math.min(predicted_util,100)
            //push to new array using a deep copy
            outp.push(JSON.parse(JSON.stringify(inp[i])))
            outp[outp.length-1]['cpu/utilization'] = predicted_util
            //keep track of time
            abs_time_ctr += outp[outp.length-1]['duration']
        }

        return outp

    }

    //helper function for calculating polynomials
    function calculatePolynomial(a, x) {
        y = 0
        for (let i = 0; i < a.length; i++) {
            y += a[i] * Math.pow(x, (a.length - 1 - i));
        }
        return y
    }

    return {
        metadata,
        execute,
    };
};

exports.Interpolate = Interpolate;