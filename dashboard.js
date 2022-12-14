
    /**
     * Global layout (each feature graph)
    */
    const svg_height = 180;
    const svg_width = 1200;
    const margin = {"left": 50, "right": 90, "top": 20, "bottom": 20};
    // right margin.right:45 fills space to panel
	const g_height = svg_height - margin.top  - margin.bottom;
	const g_width  = svg_width  - margin.left - margin.right;
    const extent = [[0, 0], [g_width, g_height]];
    const plot_column = d3.select(".col1");

    /**
     * Data-related variables
    */
    /** @type {!Array<dict>} Data loaded from CSV-file */
    var data;

    /** @type {Array<String>} Column names (fields) of the dataset */
    var fields;

    /** @type {Array<String>} Column names of currently displayed fields */
    const y_active = ["California","Washington","NewYork","Texas"];

    /** @type {String} Field to be used for x-axis */
    var x_field = "ts";

    /** @type {dict<x-value,index>} */
    var x_data = {};

    /** @type {Array<number>} The two endpoints of the x-axis */
    var xRange;

    /**
     * d3.js variables
    */
    const num_xticks = 8;
    var num_yticks = 5;
    var xScale;
    var yScales = {};   /** @type {dict<d3.scaleLinear>} Scales for each data field (key: fieldName) */
    var xScaleBars;
    var xAxis;

    var bars = {};
    var rid;  // current bar index (w.r.t. x-axis data)

    /*
     * Brush & zoom
    */
    var brush;
    //var brushes = {};  // in case of multiple brushes, one for each SVG
    var gbrushes;
    var curr_gbrush_selection;
    var idleTimeout;     // using inside brush callbacks


    // Enable this section for a dispatcher solution (a bit laggy due to additional function call)

    // Create a didpatcher and register custom events
    // We can use 'apply' and 'this' to unpack a list as input arguments
    let bar_events = ["focus","unfocus"];
    var dispatcher = d3.dispatch.apply(this, bar_events)  // == dispatcher("focus","unfocus")

    dispatcher.on("focus", cb_focus)
    dispatcher.on("unfocus", cb_unfocus)

    function cb_focus(rid) {
        for (y_field of Object.keys(yScales) ) {
            bars[y_field][rid]
                .style("opacity", "1.0")
        }
    }
    function cb_unfocus(rid) {
        for (y_field of Object.keys(yScales) ) {
            bars[y_field][rid]
                .style("opacity", "0.0")
        }
    }



    // Resize if the initial browser-window size is below some threshold
    rescaleDOM();

    // Load the data
	Promise.all([
        d3.csv("./median_single_family_house_price_by_7_selected_regions.csv")
    ]).then(showData);


    /**
     * Setup the initial state of the dashboard: show selected data & "select"
     * corresponding check boxes in panel.
     * @param {function(js.Array): null} showData
    */
    function showData(data_promises) {
        /*
         * PRE-PROCESSING (optional)
        */
        // Promise.all returns an array, each item contains the dataset of one file
        data = data_promises[0];
        fields = data.columns;
        // Transform json data into js.Array
        //d3.entries(data)

        // Select subset of data (slices start at 0 and do not include the last element)
        data = data.slice(1, data.length);

        // Transform timestamps from string into js.Date objects
        data.forEach(function(d) {
    		d.ts = d3.timeParse("%Y-%m-%d")(d[x_field]);
        });

        // Store the indices correcponding to the numerical date representation.
        // This improves performance of "mouseover" event callbacks (bar highlighting).
        // O(1) dictionary access instead of O(N) search.
        data.forEach( function(d,i) {
            x_data[d[x_field].getDate()] = i;
        })

        /**
         * INITIALIZE AXES & SCALES
        */
        xRange = d3.extent(data, d => d[x_field])  // d[x_field].getTime()
        //xScale = d3.scaleLinear()
        xScale = d3.scaleTime()
			.domain(xRange)
      		.range([0, g_width]);

        xAxis = d3.axisBottom(xScale)
            //.tickSize([outer,inner])
            //.tickPadding(8)
            .tickFormat(d3.timeFormat("%Y-%m-%d")) // also handles the conversion number : new Date()
            .ticks(num_xticks);
            //.ticks(d3.timeHour.every(25));

        // A band scale for the bard below the line (used for highlighting)
        xScaleBars = d3.scaleBand()
            .range([0, g_width])
            .domain( Object.keys(x_data) );

        // Add a brush over the entire graph area
        brush = d3.brushX()
            .extent(extent)
            .on("start", cb_start)
            .on("brush", cb_brush) // mousemove
            .on("end", cb_end);
         /*
         // In case of multiple brushes, one for each SVG
        for (var key in brushes){
            brushes[key].on("start", cb_start);
            brushes[key].on("brush", cb_brush);
            brushes[key].on("end", cb_end);
        }
        */

        /**
         * CREATE THE FEATURE PANEL
        */
        let panel = d3.select("#panel");
        for (let i=0; i<fields.length; i++) {
            if (fields[i] != "ts") {
                // For each field, append a labeled checkbox and a linebreak
                // Pass the current checkbox container (label) to the callback as "this"
                let label = panel.append("label")
                    .html(`<input type='checkbox' name='${fields[i]}'
                           onclick='cb_checkbox_panel(this)'> &nbsp;${fields[i]}`)
                    .attr("class", "panel-checkbox-label");
                panel.append("br");
            }
        }
        // Compute max size of feature labels and scale the panel width accordingly
        let max_label_width = 0;
        let featLabels = $(document.getElementsByClassName('panel-checkbox-label'))
        for (let i=0; i < featLabels.length; i++) {
            let w = $(featLabels[i]).width();
            if (w > max_label_width) {
                max_label_width = w;
            }
        }
        // Scale the panel
        d3.select(".panel-container").style("width", String(max_label_width + 35)+"px");

        /**
         * INIT THE DASHBOARD WITH A SUBSET OF FIELDS (y_active)
        */
        y_active.forEach( y_field => {
            // Activate the corresponding checkbox for this field
            document.getElementsByName(y_field)[0].checked = true;
            add_chart(data, x_field, y_field);
        } )
    }

    /**
     * Add a chart after selection in the feature panel
     * @param {Array} data The loaded data
     * @param {String} x_field The x-axis column name
     * @param {String} y_field The graph of this field will be appended
    */
    function add_chart(data, x_field, y_field) {

        /**
         * CREATE THE DIV-CONTAINER & SVG
        */
        div_container = plot_column.append("div")
                            .attr("id","div_plot_" + y_field)
                            .attr("class","div-container");

        svg_container = div_container.append("div")
                            .attr("id", "svg_container_" + y_field)
                            .attr("class","svg-container");

        // Add an SVG group to summarize graph elements
        let svg = svg_container.append("svg")
            .attr("id", "svg_"+y_field) // String(idx)
            //.style("border", "solid 1px black")
            .attr("class","div-container")
            // Make the SVG scalable when the browser window size changes
            .attr("preserveAspectRatio", "xMinYMin meet")
            .attr("viewBox", `0 0 ${svg_width} ${svg_height}`)
            .classed("svg-content", true)
            // This group gets stored in the "svg" variable
            .append("g")
                .attr("id", "graph_"+y_field) // String(idx)
                .attr("name","graph_group")
                .attr("transform", `translate( ${margin.left}, ${margin.top})`)
                // Double click into any graph should reset ALL graphs simultaneously
                .on("dblclick", function() {
                    // Rescale the (common) xaxis to original scale
                    xScale.domain(xRange)
                    xScaleBars.domain( Object.keys(x_data) );
                    // Redraw each graph using the original xScale
                    let active_fields = Object.keys(yScales);
                    active_fields.forEach( y_field => {
                        //console.log(yScales)
                        redraw( y_field, 500)
                    });
                });


        /**
         * REGISTER BRUSH
        */
        // Add a brush to the main SVG group before! adding the rectangles
        // (Otherwise: brush area covers rectangles and their mouseover event does not fire)
        svg.append("g")
            .attr("class", "gbrush")
            .attr("id", "gid_"+y_field)
            .call( brush );

        // Store a handle to all gbrush-groups (user in mouse-event callbacks)
        gbrushes = d3.selectAll(".gbrush");
        /* In case of multiple brushes, one for each svg:
           const newBrush = d3.brushX().extent(extent)
           brushes.push({"gid": "gid_"+y_field, "brush":newBrush});
           brushes["gid_"+y_field] = newBrush;
        */

        /**
         * CREATE SCALES, AXES, TICKS, AND THE LINE
        */

        // Note: common xScale defined globally

		let yScale = d3.scaleLinear()
			.domain(d3.extent(data, d => +d[y_field]) )
            .range([g_height, 0]);
        yScales[y_field] = yScale;

        let yAxis = d3.axisLeft(yScale)
            .ticks(num_yticks);

        let xTicks = d3.axisBottom(xScale)
            .tickSize(-g_height)
            .tickFormat("")
            .ticks(num_xticks);

        let yTicks = d3.axisLeft(yScale)
            .tickSize(-g_width)
            .tickFormat("")
            .ticks(num_yticks);

        let line = d3.line()
			.x(d => xScale(d[x_field].getTime())) //dd => +dd.req_total  (x)
            .y(d => yScale( +d[y_field] ))
            .defined(d => !!d);  // .defined(d => !isNaN(d.value))


        /**
         * ADD AXES & TICKS TO THE MAIN SVG GROUP
        */

        let gxAxis = svg.append("g")
			 .attr("transform", `translate(0, ${g_height})`)
             .attr("id", "xAxis")
             .attr("class","axis")
             .call(xAxis);
             // If the x-axis should be cut off based on the clip path (axis labels might be cut)
             //.attr("clip-path", `url(${window.location.pathname}#clip)`)
             //.style("-webkit-clip-path", `url(${window.location.pathname}#clip)`)
             // -webkit-clip-path  CSS style needed to work with Safari

        let gyAxis = svg.append("g")
             .attr("id", "yAxis")
             .attr("class","axis")
             .call(yAxis);

        gxTicks = svg.append("g")
            .attr("class", "xgrid")
            .attr("transform", `translate(0, ${g_height})`)
            .call(xTicks);

        gyTicks = svg.append("g")
            .attr("class", "ygrid")
            .call(yTicks);


        /**
         * DEFINE A CLIP-PATH & ADD DRAW THE LINE INSIDE THE CLIP-GROUP:
        */
        // A clip-path defines an area inside an SVG, , e.g., circle(40%), rect(...), etc.
        // Any graph element or group inside the SVG can set the "clip-path" property (or CSS-style)
        // referring to this definition. Everything outside this area is clipped (not displayed).
        // Otherwise, during a transition, the line will be drawn outside the axes boundaries
        // to the borders of the SVG.
        // Note the bars do not undergo a transition. They are re-drawn after the transition
        // in the right scale (therefore, dont need to be part of the clip path)
        let clip = svg.append("defs")
            .append("svg:clipPath")
            .attr("id", "clip")
                .append("svg:rect")
                .attr("width", g_width )
                .attr("height", g_height )
                .attr("x", 0)
                .attr("y", 0);

        // Create an inner SVG-group with clip-path property to summarize all graph elements
        // that should be clipped (the line, but not the axes)
        let gclip = svg.append("g")
            .attr("name","clip-group")
            .attr("clip-path", `url(${window.location.pathname}#clip)`)
            .style("-webkit-clip-path", `url(${window.location.pathname}#clip)`);
            // -webkit-clip-path  CSS style needed to work with Safari
            // Instead of "url(#clip)", the entire filename is necessary when the
            // attribute is set in an external CSS file (which has no pointer to this file).
            // It seems that Safari does not support clip-paths specified in external CSS files

        // Draw the line inside the clip-group
        gclip.append("path")
               .datum(data)
               .attr("class", "line")
               .attr("d", line(data) );

        /**
         * CREATE BARS UNDER THE LINE (HIGHLIGHTING)
        */
        // One bar (rect) for each data point (using the same yScale)
        bars[y_field] = {};
        svg.selectAll("[name=bar]")   /* "bar" is undefined? */
            .data(data)
            .enter().append("rect")
                .attr("name","bar")
                .attr("class", "bars_"+y_field)
                .attr("x", d => xScaleBars(d[x_field].getTime()))
                .attr("y", d => yScale(+d[y_field]))
                .attr("id", function(d,i) { //  'd' refers to the data item, 'this' refers to the rectangle object
                    // Assign an ID related to the current x-axis value (numeric Data value).
                    // The bars of all graphs at this Date get the same ID. Also store the
                    // rectangle-selections in a dictionary, accessible via x-axis index
                    // This improves performance: O(1) access rather than d3.select when
                    // handling "mouseover" events
                    bars[y_field][i] = d3.select(this);
                    return i;
                    //return x_data[d[x_field].getTime()];  // same output, too complex
                })
                .style("fill", "grey")
                .style("opacity", "0.0")
                .style("width", xScaleBars.bandwidth()+'px')  // units (px) are essential for Firefox!
                .style("height", function(d) {
                        return g_height - yScale(+d[y_field]) + 'px';
                })
                // On mouseover-event, highlight the current data point (rect)
                .on("mouseover", function(d,i) {
                    // Get the ID of the current bar (= id of all bar at this x-value)
                    // Loop all active fields (existing graphs) and change the bar style
                    rid = d3.select(this).attr("id");
                    for (y_field of Object.keys(yScales) ) {
                        bars[y_field][rid]
                            .style("opacity", "1.0")
                    }
                    /*
                    // Dispatcher solution (but a bit laggy due to additional function call)
                    // -- invoke all callbacks of type 'focus' with the curren 'this' context and callback argument 'rid'
                    dispatcher.call("focus", this, rid)
                    *//*
                    // Direct selection is also laggy
                    //d3.selectAll(`#r_${i}`)
                    //        .style("opacity", "0.0")
                    */
                })
                // Revert the highlighting effect when the mouse moves on
                .on("mouseout", function(d,i) {
                    rid = d3.select(this).attr("id");
                    for (y_field of Object.keys(yScales) ) {
                        bars[y_field][rid]
                            .style("opacity", "0.0")
                    }
                    /*
                    // Dispatcher solution (but a bit laggy due to additional function call)
                    dispatcher.call("unfocus", this, rid)
                    *//*
                    // Direct selection is also laggy
                    //d3.selectAll(`#r_${i}`)
                    //        .style("opacity", "0.0")
                    */
                });


        // Update  active fields
        y_active.push(y_field);

        /**
         * RESCALE DOM ELEMENTS
        */
        rescaleDOM();  // if browser-window size is below some threshold
    }


    /**
     * Callback for brush-event "start"
    */
    function cb_start() {

        let e = d3.event;
        //console.log(e.sourceEvent.type)

        // Avoid endless loops due to automatically controlled brushes in other graphs by
        // explicitly checking for user-initiated brush events
        // (The brush.move function is triggered again each time the current brush-event ends)
        // --> "mousedown"    // MouseEvent (user)  or   BrushEvent (program)
        if (e.sourceEvent.type !== "mousedown" ) return;   // or .type !== "brush"

        // Store a selection of the currently active graphs to be re-used in "brush" callback:
        // Get the ID of the current ggraph group, the current_gbrush_selection consists of all
        // other graphs. This is used to control the brush in all other graphs
        // (The brush in the current graph is user controlled and does not need to be re-drawn)
        let gid = this.id;
        curr_gbrush_selection = d3.selectAll(".gbrush")
            .filter( function(d,i) {
                return this.id != gid ? this : null;
                // Within this scope, "this" is required to refer to the current element
                // ("d" is "undefined" in .filter, so don't use arrow function here)
            })
    }


    /**
     * Callback for brush-event "brush" (== mousemove)
    */
    function cb_brush() {

        let e = d3.event;
        //console.log(e.sourceEvent.type)

        // Avoid endless loops due to automatically controlled brushes in other graphs by
        // explicitly checking for user-initiated brush events
        // (The brush.move function is triggered again each time the current brush-event ends)
        // --> "mousemove"  or  "brush"     // MouseEvent (user)  or   BrushEvent (program)
        if (e.sourceEvent.type !== "mousemove" ) return;   // or .type !== "brush"

        let s = e.selection;
        if (!s) {
            return;
        }
        else {
            // Re-use active graph selection to programatically move the brush
            // simultaneously in all graphs
            // NOTE: This also fires callbacks, so we need to check for user brush events
            curr_gbrush_selection
                .each(function() {
                    d3.select(this).call( brush.move, [s[0],s[1]] )
                });
            return;
        }
    }

    /**
     * Callback for brush-event "brush" (== mousemove)
    */
    function cb_end() {

        let e = d3.event;
        //console.log(e.sourceEvent.type)
        // Avoid endless loops due to automatically controlled brushes (brush.move) in other graphs by
        // explicitly checking for user-initiated brush events.
        // (The brush.move function is triggered again each time the current brush-event ends)
        // --> "end" for programatically controlled brush event, "mouseup" for the (relevant) user event
        if (e.sourceEvent.type !== "mouseup" ) return;   // or .type !== "brush"

        // This is essential to avoid endless loops when the brush.move function
        // is triggered again each time the brush stops moving ("end" event, even when
        // the brush is programatically controlled)
        if (d3.event.selection) {
            // Reset all brushes and create a new selection with the new coordinates (brush.move).
            let gbrushes = d3.selectAll(".gbrush")
            gbrushes.each( function() {
                    let graph = d3.select(this)
                    graph.call( brush.move, null )
                    // In case of multiple brushes (one for each plot):
                    //d3.select(this).call( brushes[this.id].move, null )
                });

            // Find the subset of x-axis values for the current selection
            // Compare "Data" as "int" using Date.getTime() values rather than long Date strings)
            let newXArr = Object.keys(x_data).filter(function(d) {
                return (d >= xScale.invert(e.selection[0])) &&
                       (d <= xScale.invert(e.selection[1]));
            })

            // Re-define the (global) bar-scale using the above subset of x-values
            xScaleBars
                .domain(newXArr)
                .range([0, g_width])

            // Rescale the (global) x-axis using the selected boundaries
            // NOTE: Do this AFTER filtering the data for the bars as filtering depends on old xScale
            let newXRange = [ xScale.invert(e.selection[0]), xScale.invert(e.selection[1]) ]
            xScale
                .domain(newXRange)
                .range([0, g_width])

            // Redraw the each graph using the new (common) xScale
            gbrushes
                .each( function() {
                    let y_field = this.id.replace(/^gid_/, '') // extract y_field name of each graph
                    redraw(y_field, 1000)
                })
        }
    }


    /**
     * Redraw a chart after zooming/brushing
     * @param {String} y-field The graph of this field will be re-drawn
     * @param {number} trans_delay The transition delay for brushing/zooming
    */
    function redraw(y_field, trans_delay) {

        // Retrieve the svg-group for the given y_field
        let gsvg = d3.select("#graph_"+y_field);

        // Define a new line with updated scales and re-draw it
        let newLine = d3.line()
            .x(d => xScale(d[x_field].getTime()))
            .y(d => yScales[y_field]( +d[y_field] ))
            .defined(d => !!d);
            // .defined(d => !isNaN(d.value));
        gsvg.select('.line')
            .transition()
            .duration(trans_delay)
            .attr("d", newLine(data));

        // Define a new xAxis using the new xScale, then
        // retrieve local xAxis-group & redraw the xAxis
        let newXAxis = d3.axisBottom(xScale)
            .ticks(num_xticks)
            .tickFormat(d3.timeFormat("%Y-%m-%d"));
        gsvg.select("#xAxis")
            .transition()
            .duration(trans_delay)
            .call(newXAxis);

        // Define a new xGrid using the new xScale, then
        // retrieve the local xGrid-group & redraw the xGrid
        let newxGrid = d3.axisBottom(xScale)
            .tickSize(-g_height)
            .tickFormat("")
            .ticks(num_xticks)
        gsvg.select(".xgrid")
            .transition()
            .duration(trans_delay)
            .call(newxGrid);

        // Specify the bar style (transparent when not hovered)
        gsvg.selectAll(".bars_"+y_field)
            .attr("x", d => xScaleBars(d[x_field].getTime()))
            .attr("y", d => yScales[y_field](+d[y_field]))
            .style("fill", "grey")
            .style("opacity", "0.0")
            .style("width", xScaleBars.bandwidth()+'px');
    }


    /**
     * Event listener for resizing the browser window
     * Resize SVGs using viewbox property:
     * <svg class="svg-content" viewBox="0 0 120 120" preserveAspectRatio="xMinYMin meet" )
    */
    $(window).resize(function() {
        rescaleDOM();
    });

    /**
     * Rescale DOM elements when the browser window is resized.
     * Elements of class "scalable" can be scaled to a certain limit such that panel
     * items are always clearly visible.
    */
    function rescaleDOM()
    {
        let windowWidth = $(window).width();
        var winSVGRatioLimit = Math.min( windowWidth / svg_width *2, 1) ;
        // Factor 2 due to align {left, top}. (using scale alignes element in the center such that total area is doubled
        $(".scalable").css(
        {
            "-moz-transform": "scale("+winSVGRatioLimit +")",
            "-moz-transform-origin": "0px 0px",
            "-webkit-transform": "scale("+winSVGRatioLimit +")",
            "-webkit-transform-origin": "0px 0px",
            //"-webkit-transform-origin-y": 0,
            "transform": "scale("+winSVGRatioLimit +")"
        });
        var winSVGRatio = windowWidth / svg_width;
        $(".div-container").css(
        {
            "height": winSVGRatio * (svg_height * 0.9)
            // Scale svg_height by the width ratio.
            // Multiply by 0.9 to leave a minimal space between graph-divs, or 0.86 w/o space
        });
    }


    /**
     * Callback for checkboxes in the feature panel.
     * Handles event by verifying the "checked" attribute of the currently selected <input> tag.
     * @param {html-tag} e HTML <input> tag of the selected checkbox
    */
    function cb_checkbox_panel(e) {
        //console.log(e)
        let y_field = e.name;
        if (e.checked) {
            add_chart(data, x_field, y_field);
            //gbrushes = d3.selectAll(".gbrush")
            // --> updated inside add_chart to work right after initial loading of the page
            // Newly added charts use the same global xScale (correct scaling for the current zoom)
        } else {
            // Delete corresponding DOM elements and any data related to that graph
            document.getElementById("div_plot_" + y_field).remove();  // this function takes the ID w/o "#"
            delete yScales[y_field];
            delete bars[y_field];
            // Remove one element at index of the current y_field
            y_active.splice( y_active.indexOf(y_field), 1 );
        }
    }
