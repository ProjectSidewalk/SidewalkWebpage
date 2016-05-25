var GSVPANO = GSVPANO || {};
GSVPANO.PanoLoader = function (parameters) {

    'use strict';

    var _parameters = parameters || {},
        _location,
        _zoom,
        _panoId,
        _panoClient = new google.maps.StreetViewService(),
        _count = 0,
        _total = 0,
        _canvas = document.createElement('canvas'),
        _ctx = _canvas.getContext('2d'),
        rotation = 0,
        copyright = '',
        onSizeChange = null,
        onPanoramaLoad = null;

    if ("panoId" in parameters) {
        _panoId = parameters.panoId;
    }

    this.setProgress = function (p) {
    
        if (this.onProgress) {
            this.onProgress(p);
        }
        
    };

    this.throwError = function (message) {
    
        if (this.onError) {
            this.onError(message);
        } else {
            console.error(message);
        }
        
    };

    this.adaptTextureToZoom = function () {
    
        var w = 416 * Math.pow(2, _zoom),
            h = (416 * Math.pow(2, _zoom - 1));
        _canvas.width = w;
        _canvas.height = h;
        //_ctx.translate( _canvas.width, 0);  // KH: What was this for???
        //_ctx.scale(-1, 1);
    };

    this.composeFromTile = function (x, y, texture) {
    
        _ctx.drawImage(texture, x * 512, y * 512);
        _count++;
        
        var p = Math.round(_count * 100 / _total);
        this.setProgress(p);
        
        if (_count === _total) {
            this.canvas = _canvas;
            if (this.onPanoramaLoad) {
                this.onPanoramaLoad();
            }
        }
        
    };

    this.composePanorama = function () {
    
        this.setProgress(0);
        console.log('Loading panorama for zoom ' + _zoom + '...');
        
        var w = Math.pow(2, _zoom),
            h = Math.pow(2, _zoom - 1),
            self = this,
            url,
            x,
            y;
            
        _count = 0;
        _total = w * h;
        
        for( y = 0; y < h; y++) {
            for( x = 0; x < w; x++) {
                url = 'http://maps.google.com/cbk?output=tile&panoid=' + _panoId + '&zoom=' + _zoom + '&x=' + x + '&y=' + y + '&' + Date.now();
                (function (x, y) { 
                    var img = new Image();
                    img.addEventListener('load', function () {
                        self.composeFromTile(x, y, this);
                    });
                    img.crossOrigin = '';
                    img.src = url;
                })(x, y);
            }
        }
        
    };

    this.load = function (location) {
    
        console.log('Load for', location);
        var self = this;
        _panoClient.getPanoramaByLocation(location, 50, function (result, status) {
            if (status === google.maps.StreetViewStatus.OK) {
                if( self.onPanoramaData ) self.onPanoramaData( result );
                var h = google.maps.geometry.spherical.computeHeading(location, result.location.latLng);
                rotation = (result.tiles.centerHeading - h) * Math.PI / 180.0;
                copyright = result.copyright;
                self.copyright = result.copyright;
                _panoId = result.location.pano;
                self.panoId = _panoId;
                self.location = location;
                self.composePanorama();
            } else {
                if( self.onNoPanoramaData ) self.onNoPanoramaData( status );
                self.throwError('Could not retrieve panorama for the following reason: ' + status);
            }
        });
        
    };

    this.loadById = function (panoId) {
        var self = this;
        _panoClient.getPanoramaById(panoId, function (result, status) {
            if (status === google.maps.StreetViewStatus.OK) {
                if( self.onPanoramaData ) self.onPanoramaData( result );
                var h = google.maps.geometry.spherical.computeHeading(location, result.location.latLng);
                rotation = (result.tiles.centerHeading - h) * Math.PI / 180.0;
                copyright = result.copyright;
                self.copyright = result.copyright;
                _panoId = result.location.pano;
                self.panoId = _panoId;
                self.location = location;
                self.composePanorama();
            } else {
                if( self.onNoPanoramaData ) self.onNoPanoramaData( status );
                self.throwError('Could not retrieve panorama for the following reason: ' + status);
            }
        });
    };
    
    this.setZoom = function( z ) {
        _zoom = z;
        this.adaptTextureToZoom();
    };

    this.setZoom( _parameters.zoom || 1 );

};
var GSVPANO = GSVPANO || {};
GSVPANO.PanoPointCloudLoader = function (parameters) {

    'use strict';

    var _parameters = parameters || {},
        onDepthLoad = null,
        onPointCloudLoad = null;

    this.load = function(panoId) {
        var self = this,
            url;

        //url = "http://maps.google.com/cbk?output=json&cb_client=maps_sv&v=4&dm=1&pm=1&ph=1&hl=en&panoid=" + panoId;
        url = "https://maps.google.com/cbk?output=json&cb_client=maps_sv&v=4&dm=1&pm=1&ph=1&hl=en&panoid=" + panoId;

        $.ajax({
                url: url,
                dataType: 'jsonp'
            })
            .done(function(data, textStatus, xhr) {
                var decoded; //, depthMap;
                var pointCloud;

                try {
                    decoded = self.decode(data.model.depth_map);
                    // depthMap = self.parse(decoded);
                    pointCloud = self.parse(decoded);
                } catch(e) {
                    console.error("Error loading depth map for pano " + panoId + "\n" + e.message + "\nAt " + e.filename + "(" + e.lineNumber + ")");
                    // depthMap = self.createEmptyDepthMap();
                    pointCloud = self.createEmptyPointCloud();
                }
                if(self.onPointCloudLoad) {
                    var x, y, z, r2;
                    var points = [];
                    for (var i = 0; i < pointCloud.pointCloud.length; i += 3) {
                        x = pointCloud.pointCloud[i];
                        y = pointCloud.pointCloud[i + 1];
                        z = pointCloud.pointCloud[i + 2];
                        r2 = x * x + y * y + z * z;
                        if (r2 < 10000) {
                            points.push({x: x, y: y, z: z, id: i});
                        }
                    }

                    self.pointCloud = pointCloud;
                    self.pointCloud.tree = null;
                    // self.pointCloud.tree = new kdTree(points, svl.util.math.distance3d, ['x', 'y', 'z']);

                    self.onPointCloudLoad();
                }
            })
            .fail(function(xhr, textStatus, errorThrown) {
                console.error("Request failed: " + url + "\n" + textStatus + "\n" + errorThrown);
                // var depthMap = self.createEmptyDepthMap();
                var pointCloud = self.createEmptyPointCloud();
                if(self.onPointCloudLoad) {
                    // self.depthMap = depthMap;
                    self.pointCloud = pointCloud;
                    // self.onDepthLoad();
                    self.onPointCloudLoad();
                }
            })
    };

    this.decode = function(rawDepthMap) {
        var self = this,
                   i,
                   compressedDepthMapData,
                   depthMap,
                   decompressedDepthMap;

        // Append '=' in order to make the length of the array a multiple of 4
        while(rawDepthMap.length %4 != 0)
            rawDepthMap += '=';

        // Replace '-' by '+' and '_' by '/'
        rawDepthMap = rawDepthMap.replace(/-/g,'+');
        rawDepthMap = rawDepthMap.replace(/_/g,'/');

        // Decode and decompress data
        compressedDepthMapData = $.base64.decode(rawDepthMap);
        decompressedDepthMap = zpipe.inflate(compressedDepthMapData);

        // Convert output of decompressor to Uint8Array
        depthMap = new Uint8Array(decompressedDepthMap.length);
        for(i=0; i<decompressedDepthMap.length; ++i)
            depthMap[i] = decompressedDepthMap.charCodeAt(i);
        return depthMap;
    };

    this.parseHeader = function(depthMap) {
        return {
            headerSize : depthMap.getUint8(0),
            numberOfPlanes : depthMap.getUint16(1, true),
            width: depthMap.getUint16(3, true),
            height: depthMap.getUint16(5, true),
            offset: depthMap.getUint16(7, true)
        };
    };

    this.parsePlanes = function(header, depthMap) {
        var planes = [],
            indices = [],
            i,
            n = [0, 0, 0],
            d,
            byteOffset;

        for(i=0; i<header.width*header.height; ++i) {
            indices.push(depthMap.getUint8(header.offset + i));
        }

        for(i=0; i<header.numberOfPlanes; ++i) {
            byteOffset = header.offset + header.width*header.height + i*4*4;
            n[0] = depthMap.getFloat32(byteOffset, true);
            n[1] = depthMap.getFloat32(byteOffset + 4, true);
            n[2] = depthMap.getFloat32(byteOffset + 8, true);
            d    = depthMap.getFloat32(byteOffset + 12, true);
            planes.push({
                n: n.slice(0),
                d: d
            });
        }

        return { planes: planes, indices: indices };
    };

    this.computeDepthMap = function(header, indices, planes) {
        var depthMap = null,
            x, y,
            planeIdx,
            phi, theta,
            v = [0, 0, 0],
            w = header.width, h = header.height,
            plane, t, p;

        depthMap = new Float32Array(w*h);

        var sin_theta = new Float32Array(h);
        var cos_theta = new Float32Array(h);
        var sin_phi   = new Float32Array(w);
        var cos_phi   = new Float32Array(w);

        for(y=0; y<h; ++y) {
            theta = (h - y - 0.5) / h * Math.PI;
            sin_theta[y] = Math.sin(theta);
            cos_theta[y] = Math.cos(theta);
        }
        for(x=0; x<w; ++x) {
            phi = (w - x - 0.5) / w * 2 * Math.PI + Math.PI/2;
            sin_phi[x] = Math.sin(phi);
            cos_phi[x] = Math.cos(phi);
        }

        for(y=0; y<h; ++y) {
            for(x=0; x<w; ++x) {
                planeIdx = indices[y*w + x];

                v[0] = sin_theta[y] * cos_phi[x];
                v[1] = sin_theta[y] * sin_phi[x];
                v[2] = cos_theta[y];

                if(planeIdx > 0) {
                    plane = planes[planeIdx];

                    t = Math.abs( plane.d / (v[0]*plane.n[0] + v[1]*plane.n[1] + v[2]*plane.n[2]) );
                    depthMap[y*w + (w-x-1)] = t;
                } else {
                    depthMap[y*w + (w-x-1)] = 9999999999999999999.;
                }
            }
        }

        return {
            width: w,
            height: h,
            depthMap: depthMap
        };
    };

    this.computePointCloud = function(header, indices, planes) {
        var depthMap = null,
            pointCloud = null,
            x, y,
            planeIdx,
            phi, theta,
            //v = [0, 0, 0],
            _v = [0, 0, 0],
            w = header.width, h = header.height,
            plane, // t,
            p, _t;

        //depthMap = new Float32Array(w*h);
        pointCloud = new Float32Array(3 * w * h);

        //var sin_theta = new Float32Array(h);
        //var cos_theta = new Float32Array(h);
        //var sin_phi   = new Float32Array(w);
        //var cos_phi   = new Float32Array(w);
        var _sin_theta = new Float32Array(w);
        var _cos_theta = new Float32Array(w);
        var _sin_phi   = new Float32Array(h);
        var _cos_phi   = new Float32Array(h);

        // KH: A note on spherical coordinates for myself
        // http://mathworld.wolfram.com/SphericalCoordinates.html

        // Mapping between each y pixel coordinate and a polar angle
        for(y=0; y<h; ++y) {
            //theta = (h - y - 0.5) / h * Math.PI;
            //sin_theta[y] = Math.sin(theta);
            //cos_theta[y] = Math.cos(theta);

            phi = (h - y - 0.5) / h * Math.PI;
            _sin_phi[y] = Math.sin(phi);
            _cos_phi[y] = Math.cos(phi);
        }
        // Mapping between each x pixel coordinate and a azimuthal angle
        for(x=0; x<w; ++x) {
            //phi = (w - x - 0.5) / w * 2 * Math.PI + Math.PI/2;
            //sin_phi[x] = Math.sin(phi);
            //cos_phi[x] = Math.cos(phi);

            theta = (w - x - 0.5) / w * 2 * Math.PI + Math.PI/2;
            _sin_theta[x] = Math.sin(theta);
            _cos_theta[x] = Math.cos(theta);
        }

        for(y=0; y<h; ++y) {
            for(x=0; x<w; ++x) {
                planeIdx = indices[y*w + x];

                // A normal vector towards a pixel (x, y)
                //v[0] = sin_theta[y] * cos_phi[x];
                //v[1] = sin_theta[y] * sin_phi[x];
                //v[2] = cos_theta[y];

                _v[0] = _sin_phi[y] * _cos_theta[x];
                _v[1] = _sin_phi[y] * _sin_theta[x];
                _v[2] = _cos_phi[y];

                if(planeIdx > 0) {
                    plane = planes[planeIdx];
                    // Get a depth t. Then compute the xyz coordinate of the
                    // point of intereste from t and v.
                    //t = Math.abs(plane.d / (v[0] * plane.n[0] + v[1] * plane.n[1] + v[2] * plane.n[2]));
                    _t = Math.abs(plane.d / (_v[0] * plane.n[0] + _v[1] * plane.n[1] + _v[2] * plane.n[2]))
                    // depthMap[y*w + (w-x-1)] = t;
                    pointCloud[3 * y * w + 3 * x] = _t * _v[0];
                    pointCloud[3 * y * w + 3 * x + 1] = _t * _v[1];
                    pointCloud[3 * y * w + 3 * x + 2] = _t * _v[2];
                } else {
                    // depthMap[y*w + (w-x-1)] = 9999999999999999999.;
                    pointCloud[3 * y * w + 3 * x] = 9999999999999999999.;
                    pointCloud[3 * y * w + 3 * x + 1] = 9999999999999999999.;
                    pointCloud[3 * y * w + 3 * x + 2] = 9999999999999999999.;
                }
            }
        }

        return {
            width: w,
            height: h,
            pointCloud: pointCloud
        };
    };

    this.parse = function(depthMap) {
        var self = this,
            depthMapData,
            header,
            data,
            depthMap,
            pointCloud;

        depthMapData = new DataView(depthMap.buffer);
        header = self.parseHeader(depthMapData);
        data = self.parsePlanes(header, depthMapData);
        // depthMap = self.computeDepthMap(header, data.indices, data.planes);
        pointCloud = self.computePointCloud(header, data.indices, data.planes);

        // return depthMap;
        return pointCloud;
    };

    this.createEmptyDepthMap = function() {
        var depthMap = {
            width: 512,
            height: 256,
            depthMap: new Float32Array(512*256)
        };
        for(var i=0; i<512*256; ++i)
            depthMap.depthMap[i] = 9999999999999999999.;
        return depthMap;
    };

    this.createEmptyPointCloud = function() {
        var pointCloud = {
            width: 512,
            height: 256,
            pointCloud: new Float32Array(512*256*3)
        };
        for(var i=0; i<512*256*3; ++i)
          pointCloud.pointCloud[i] = 9999999999999999999.;
        return pointCloud;
    };

};

/**
 * ActionStack keeps track of user's actions so you can undo/redo labeling.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ActionStack () {
    var self = { className : 'ActionStack'},
        status = {
            actionStackCursor : 0, // This is an index of current state in actionStack
            disableRedo : false,
            disableUndo : false
        },
        lock = {
            disableRedo : false,
            disableUndo : false
        },
        actionStack = [],
        blinkInterval;


    function init () {
        // Initialization function
        if (svl.ui && svl.ui.actionStack) {
            svl.ui.actionStack.redo.css('opacity', 0.5);
            svl.ui.actionStack.undo.css('opacity', 0.5);

            svl.ui.actionStack.redo.bind('click', handleButtonRedoClick);
            svl.ui.actionStack.undo.bind('click', handleButtonUndoClick);
        }
    }

    /**
     * Blink undo and redo buttons
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            svl.ui.actionStack.redo.toggleClass("highlight-50");
            svl.ui.actionStack.undo.toggleClass("highlight-50");
        }, 500);
    }


    /**
     * Disable redo
     */
    function disableRedo () {
        if (!lock.disableRedo) {
            status.disableRedo = true;
            if (svl.ui && svl.ui.actionStack) {
                svl.ui.actionStack.redo.css('opacity', 0.5);
            }
            return this;
        } else {
            return false;
        }
    }

    /** Disable undo */
    function disableUndo () {
        if (!lock.disableUndo) {
            status.disableUndo = true;
            if (svl.ui && svl.ui.actionStack) {
                svl.ui.actionStack.undo.css('opacity', 0.5);
            }
            return this;
        } else {
            return false;
        }
    }

    /** Enable redo */
    function enableRedo () {
        if (!lock.disableRedo) {
            status.disableRedo = false;
            if (svl.ui && svl.ui.actionStack) {
                svl.ui.actionStack.redo.css('opacity', 1);
            }
            return this;
        } else {
            return false;
        }
    }

    /** Enable undo */
    function enableUndo () {
        if (!lock.disableUndo) {
            status.disableUndo = false;
            if (svl.ui && svl.ui.actionStack) {
                svl.ui.actionStack.undo.css('opacity', 1);
            }
            return this;
        } else {
            return false;
        }
    }

    function getStatus(key) { return (key in status) ? status[key] : null; }

    /**
     * This is a callback for redo button click
     */
    function handleButtonRedoClick () {
        if (!status.disableRedo) {
            svl.tracker.push('Click_Redo');
            redo();
        }
    }

    /**
     * This is a callback for undo button click
     */
    function handleButtonUndoClick () {
        if (!status.disableUndo) {
            svl.tracker.push('Click_Undo');
            undo();
        }
    }

    /**
     * Lock disable redo
     * @returns {lockDisableRedo}
     */
    function lockDisableRedo () {
        lock.disableRedo = true;
        return this;
    }

    /**
     * Lock disable undo
     * @returns {lockDisableUndo}
     */
    function lockDisableUndo () {
        lock.disableUndo = true;
        return this;
    }

    /**
     * Pop an action
     */
    function pop () {
        if (actionStack.length > 0) {
            status.actionStackCursor -= 1;
            actionStack.splice(status.actionStackCursor);
        }
        return this;
    }


    /**
     * Push an action
     */
    function push (action, label) {
        var availableActionList = ['addLabel', 'deleteLabel'];
        if (availableActionList.indexOf(action) === -1) {
            throw self.className + ": Illegal action.";
        }

        var actionItem = {
            action : action,
            label : label,
            index : status.actionStackCursor
        };
        if (actionStack.length !== 0 &&
            actionStack.length > status.actionStackCursor) {
            // Delete all the action items after the cursor before pushing the new acitonItem
            actionStack.splice(status.actionStackCursor);
        }
        actionStack.push(actionItem);
        status.actionStackCursor += 1;
        return this;
    }

    /**
     * Redo an action
     */
    function redo () {
        if (!status.disableRedo) {
            if (actionStack.length > status.actionStackCursor) {
                var actionItem = actionStack[status.actionStackCursor];
                if (actionItem.action === 'addLabel') {
                    if ('tracker' in svl) {
                        svl.tracker.push('Redo_AddLabel', {labelId: actionItem.label.getProperty('labelId')});
                    }
                    actionItem.label.setStatus('deleted', false);
                } else if (actionItem.action === 'deleteLabel') {
                    if ('tracker' in svl) {
                        svl.tracker.push('Redo_RemoveLabel', {labelId: actionItem.label.getProperty('labelId')});
                    }
                    actionItem.label.setStatus('deleted', true);
                    actionItem.label.setVisibility('hidden');
                }
                status.actionStackCursor += 1;
            }
            if ('canvas' in svl) {
                svl.canvas.clear().render2();
            }
        }
    }

    /** return the size of the stack */
    function size () {
        return actionStack.length;
    }

    /**
     * Stop blinking undo and redo buttons
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        svl.ui.actionStack.redo.removeClass("highlight-50");
        svl.ui.actionStack.undo.removeClass("highlight-50");
    }

    /** Undo an action */
    function undo () {
        if (!status.disableUndo) {
            status.actionStackCursor -= 1;
            if(status.actionStackCursor >= 0) {
                var actionItem = actionStack[status.actionStackCursor];
                if (actionItem.action === 'addLabel') {
                    if ('tracker' in svl) {
                        svl.tracker.push('Undo_AddLabel', {labelId: actionItem.label.getProperty('labelId')});
                    }
                    actionItem.label.setStatus('deleted', true);
                } else if (actionItem.action === 'deleteLabel') {
                    if ('tracker' in svl) {
                        svl.tracker.push('Undo_RemoveLabel', {labelId: actionItem.label.getProperty('labelId')});
                    }
                    actionItem.label.setStatus('deleted', false);
                    actionItem.label.setVisibility('visible');
                }
            } else {
                status.actionStackCursor = 0;
            }

            if ('canvas' in svl) {
                svl.canvas.clear().render2();
            }
        }
    }

    function unlockDisableRedo () { lock.disableRedo = false; return this; }

    function unlockDisableUndo () { lock.disableUndo = false; return this; }

    function getLock (key) { return (key in lock) ? lock[key] : null; }

    /** Change opacity */
    function updateOpacity () {
        if (svl.ui && svl.ui.actionStack) {
            if (status.actionStackCursor < actionStack.length) {
                svl.ui.actionStack.redo.css('opacity', 1);
            } else {
                svl.ui.actionStack.redo.css('opacity', 0.5);
            }

            if (status.actionStackCursor > 0) {
                svl.ui.actionStack.undo.css('opacity', 1);
            } else {
                svl.ui.actionStack.undo.css('opacity', 0.5);
            }

            // if the status is set to disabled, then set the opacity of buttons to 0.5 anyway.
            if (status.disableUndo) {
                svl.ui.actionStack.undo.css('opacity', 0.5);
            }
            if (status.disableRedo) {
                svl.ui.actionStack.redo.css('opacity', 0.5);
            }
        }
    }

    self.blink = blink;
    self.disableRedo = disableRedo;
    self.disableUndo = disableUndo;
    self.enableRedo = enableRedo;
    self.enableUndo = enableUndo;
    self.getStatus = getStatus;
    self.lockDisableRedo = lockDisableRedo;
    self.lockDisableUndo = lockDisableUndo;
    self.pop = pop;
    self.push = push;
    self.redo = redo;
    self.size = size;
    self.undo = undo;
    self.unlockDisableRedo = unlockDisableRedo;
    self.unlockDisableUndo = unlockDisableUndo;
    self.getLock = getLock;
    self.stopBlinking = stopBlinking;
    self.updateOpacity = updateOpacity;

    init();

    return self;
}

/**
 * Audio Effect module.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function AudioEffect () {
    var self = { className: 'AudioEffect' };

    if (typeof Audio == "undefined") Audio = function HTMLAudioElement () {}; // I need this for testing as PhantomJS does not support HTML5 Audio.

    var audios = {
            applause: new Audio(svl.rootDirectory + 'audio/applause.mp3'),
            drip: new Audio(svl.rootDirectory + 'audio/drip.wav'),
            glug1: new Audio(svl.rootDirectory + 'audio/glug1.wav'),
            yay: new Audio(svl.rootDirectory + 'audio/yay.mp3')
        },
        status = {
            mute: false
        },
        blinkInterval;

    if (svl && 'ui' in svl) {
        svl.ui.leftColumn.sound.on('click', handleClickSound);
    }

    /**
     * Blink
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            svl.ui.leftColumn.sound.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Callback for button click
     */
    function handleClickSound () {
        if (status.mute) {
            // Unmute
            if (svl && 'ui' in svl) {
                svl.ui.leftColumn.muteIcon.addClass('hidden');
                svl.ui.leftColumn.soundIcon.removeClass('hidden');
            }
            unmute();
        } else {
            // Mute
            if (svl && 'ui' in svl) {
                svl.ui.leftColumn.soundIcon.addClass('hidden');
                svl.ui.leftColumn.muteIcon.removeClass('hidden');
            }
            mute();
        }
    }

    /**
     * Mute
     */
    function mute () {
        status.mute = true;
    }


    /**
     * Play a sound effect
     * @param name Name of the sound effect
     * @returns {play}
     */
    function play (name) {
        if (name in audios && !status.mute && typeof audios[name].play == "function") {
            audios[name].play();
        }
        return this;
    }

    /**
     * Stop blinking the button
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        svl.ui.leftColumn.sound.removeClass("highlight-50");
    }

    /**
     * Unmute
     */
    function unmute () {
        status.mute = false;
    }

    self.blink = blink;
    self.play = play;
    self.stopBlinking = stopBlinking;
    return self;
}
// Image distortion coefficient. Need to figure out how to compute these.
// It seems like these constants do not depend on browsers... (tested on Chrome, Firefox, and Safari.)
// Distortion coefficient for a window size 640x360: var alpha_x = 5.2, alpha_y = -5.25;
// Distortion coefficient for a window size 720x480:
var svl = svl || {};
svl.canvasWidth = 720;
svl.canvasHeight = 480;
svl.svImageHeight = 6656;
svl.svImageWidth = 13312;
svl.alpha_x = 4.6;
svl.alpha_y = -4.65;
svl._labelCounter = 0;
svl.getLabelCounter = function () {
    return svl._labelCounter++;
};

/**
 * A canvas module
 * @param $ {object} jQuery object
 * @param param {object} Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Canvas ($, param) {
    var self = { className : 'Canvas' };

        // Mouse status and mouse event callback functions
    var mouseStatus = {
            currX:0,
            currY:0,
            prevX:0,
            prevY:0,
            leftDownX:0,
            leftDownY:0,
            leftUpX:0,
            leftUpY:0,
            isLeftDown: false,
            prevMouseDownTime : 0,
            prevMouseUpTime : 0
        };
        // Properties
    var properties = {
        drawingMode: "point",
        evaluationMode: false,
        radiusThresh: 7,
        showDeleteMenuTimeOutToken : undefined,
        tempPointRadius: 5
    };

    var pointParameters = {
        'fillStyleInnerCircle' : 'rgba(0,0,0,1)', // labelColor.fillStyle,
        'lineWidthOuterCircle' : 2,
        'iconImagePath' : undefined, // iconImagePath,
        'radiusInnerCircle' : 5, //13,
        'radiusOuterCircle' : 6, //14,
        'strokeStyleOuterCircle' : 'rgba(255,255,255,1)',
        'storedInDatabase' : false
    };

    var status = {
        currentLabel : null,
        disableLabelDelete : false,
        disableLabelEdit : false,
        disableLabeling : false,
        disableWalking : false,
        drawing : false,

        lockCurrentLabel : false,
        lockDisableLabelDelete : false,
        lockDisableLabelEdit : false,
        lockDisableLabeling : false,
        svImageCoordinatesAdjusted: false,
        totalLabelCount: 0,
        'visibilityMenu' : 'hidden'
    };

    var lock = {
        showLabelTag: false
    };

    // Canvas context
    var canvasProperties = {'height':0, 'width':0};
    var ctx;

    var tempPath = [];

    // Right click menu
    var rightClickMenu = undefined;

    // Path elements
    var systemLabels = [];
    var labels = [];


    // Initialization
    function _init (param) {
        var el = document.getElementById("label-canvas");
        if (!el) {
            return false;
        }
        ctx = el.getContext('2d');
        canvasProperties.width = el.width;
        canvasProperties.height = el.height;

        if (param && 'evaluationMode' in param) {
            properties.evaluationMode = param.evaluationMode;
        }

        // Attach listeners to dom elements
        if (svl.ui.canvas.drawingLayer) {
            svl.ui.canvas.drawingLayer.bind('mousedown', handleDrawingLayerMouseDown);
            svl.ui.canvas.drawingLayer.bind('mouseup', handleDrawingLayerMouseUp);
            svl.ui.canvas.drawingLayer.bind('mousemove', handleDrawingLayerMouseMove);
            svl.ui.canvas.drawingLayer.on('mouseout', handleDrawingLayerMouseOut);
        }
        if (svl.ui.canvas.deleteIcon) {
          svl.ui.canvas.deleteIcon.bind("click", labelDeleteIconClick);
        }

        // Point radius
        if (properties.drawingMode == 'path') {
            properties.pointInnerCircleRadius = 5;
            properties.pointOuterCircleRadius = 6;
        } else {
            properties.pointInnerCircleRadius = 13;
            properties.pointOuterCircleRadius = 14;
        }
    }

    /**
     * Finish up labeling.
     * Clean this method when I get a chance.....
     */
    function closeLabelPath() {

        var labelType = svl.ribbon.getStatus('selectedLabelType'),
            labelColor = svl.misc.getLabelColors()[labelType],
            labelDescription = svl.misc.getLabelDescriptions(svl.ribbon.getStatus('selectedLabelType')),
            iconImagePath = svl.misc.getIconImagePaths(labelDescription.id).iconImagePath;

        pointParameters.fillStyleInnerCircle = labelColor.fillStyle;
        pointParameters.iconImagePath = iconImagePath;
        pointParameters.radiusInnerCircle = properties.pointInnerCircleRadius;
        pointParameters.radiusOuterCircle = properties.pointOuterCircleRadius;

        var pathLen = tempPath.length,
            points = [],
            pov = svl.map.getPov();

        for (var i = 0; i < pathLen; i++) {
            points.push(new Point(tempPath[i].x, tempPath[i].y, pov, pointParameters));
        }
        var path = new Path(points, {});
        var latlng = svl.map.getPosition();
        var param = {
            canvasWidth: svl.canvasWidth,
            canvasHeight: svl.canvasHeight,
            canvasDistortionAlphaX: svl.alpha_x,
            canvasDistortionAlphaY: svl.alpha_y,
            //labelId: svl.getLabelCounter(),
            labelType: labelDescription.id,
            labelDescription: labelDescription.text,
            labelFillStyle: labelColor.fillStyle,
            panoId: svl.map.getPanoId(),
            panoramaLat: latlng.lat,
            panoramaLng: latlng.lng,
            panoramaHeading: pov.heading,
            panoramaPitch: pov.pitch,
            panoramaZoom: pov.zoom,
            svImageWidth: svl.svImageWidth,
            svImageHeight: svl.svImageHeight,
            svMode: 'html4'
        };
        if (("panorama" in svl) && ("getPhotographerPov" in svl.panorama)) {
            var photographerPov = svl.panorama.getPhotographerPov();
            param.photographerHeading = photographerPov.heading;
            param.photographerPitch = photographerPov.pitch;
        }

        status.currentLabel = svl.labelFactory.create(path, param);
        labels.push(status.currentLabel);  // Todo. Delete this. I think this is not necessary.
        svl.labelContainer.push(status.currentLabel);

        if ('contextMenu' in svl) {
            svl.contextMenu.show(tempPath[0].x, tempPath[0].y, {
                targetLabel: status.currentLabel,
                targetLabelColor: labelColor.fillStyle
            });
        }

        svl.tracker.push('LabelingCanvas_FinishLabeling', {
            'temporary_label_id': status.currentLabel.getProperty('temporary_label_id'),
            'LabelType': labelDescription.id,
            canvasX: tempPath[0].x,
            canvasY: tempPath[0].y
        });
        svl.actionStack.push('addLabel', status.currentLabel);

        // Sound effect
        if ('audioEffect' in svl) {
            svl.audioEffect.play('drip');
        }

        // Initialize the tempPath
        tempPath = [];
        svl.ribbon.backToWalk();

        // Review label correctness if this is a ground truth insertion task.
        if (("goldenInsertion" in svl) &&
            svl.goldenInsertion &&
            svl.goldenInsertion.isRevisingLabels()) {
            svl.goldenInsertion.reviewLabels();
        }

    }

    function handleDrawingLayerMouseOut () {
        svl.tracker.push('LabelingCanvas_MouseOut');
        if (!("onboarding" in svl) || !svl.onboarding.isOnboarding()) {
            if ("ribbon" in svl) {
                svl.ribbon.backToWalk();
            }
        }
    }

    /**
     * This function is fired when at the time of mouse-down
     * @param e
     */
    function handleDrawingLayerMouseDown (e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = svl.util.mouseposition(e, this).x;
        mouseStatus.leftDownY = svl.util.mouseposition(e, this).y;

        svl.tracker.push('LabelingCanvas_MouseDown', {x: mouseStatus.leftDownX, y: mouseStatus.leftDownY});

        mouseStatus.prevMouseDownTime = new Date().getTime();
    }

    /**
     * This function is fired when at the time of mouse-up
     */
    function handleDrawingLayerMouseUp (e) {
        var currTime;

        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = svl.util.mouseposition(e, this).x;
        mouseStatus.leftUpY = svl.util.mouseposition(e, this).y;

        currTime = new Date().getTime();

        if (!status.disableLabeling && currTime - mouseStatus.prevMouseUpTime > 300) {
            if (properties.drawingMode == "point") {
                tempPath.push({x: mouseStatus.leftUpX, y: mouseStatus.leftUpY});
                closeLabelPath();
            } else if (properties.drawingMode == "path") {
                // Path labeling.

                if ('ribbon' in svl && svl.ribbon) {
                    // Define point parameters to draw
                    if (!status.drawing) {
                        // Start drawing a path if a user hasn't started to do so.
                        status.drawing = true;
                        if ('tracker' in svl && svl.tracker) {
                            svl.tracker.push('LabelingCanvas_StartLabeling');
                        }
                        tempPath.push({x: mouseStatus.leftUpX, y: mouseStatus.leftUpY});
                    } else {
                        // Close the current path if there are more than 2 points in the tempPath and
                        // the user clicks on a point near the initial point.
                        var closed = false;
                        if (tempPath.length > 2) {
                            var r = Math.sqrt(Math.pow((tempPath[0].x - mouseStatus.leftUpX), 2) + Math.pow((tempPath[0].y - mouseStatus.leftUpY), 2));
                            if (r < properties.radiusThresh) {
                                closed = true;
                                status.drawing = false;
                                closeLabelPath();
                            }
                        }

                        // Otherwise add a new point
                        if (!closed) {
                            tempPath.push({x: mouseStatus.leftUpX, y: mouseStatus.leftUpY});
                        }
                    }
                }
            }

            clear();
            setVisibilityBasedOnLocation('visible', svl.map.getPanoId());
            render2();
        } else if (currTime - mouseStatus.prevMouseUpTime < 400) {
            if (properties.drawingMode == "path") {
                // This part is executed for a double click event
                // If the current status.drawing = true, then close the current path.
                var pathLen = tempPath.length;
                if (status.drawing && pathLen > 2) {
                    status.drawing = false;

                    closeLabelPath();
                    self.clear();
                    self.setVisibilityBasedOnLocation('visible', svl.map.getPanoId());
                    self.render2();
                }
            }
        }


        svl.tracker.push('LabelingCanvas_MouseUp', {x: mouseStatus.leftUpX, y: mouseStatus.leftUpY});
        mouseStatus.prevMouseUpTime = new Date().getTime();
        mouseStatus.prevMouseDownTime = 0;
    }

    /**
     * This function is fired when mouse cursor moves over the drawing layer.
     */
    function handleDrawingLayerMouseMove (e) {
        var mousePosition = mouseposition(e, this);
        mouseStatus.currX = mousePosition.x;
        mouseStatus.currY = mousePosition.y;

        // Change a cursor according to the label type.
        // $(this).css('cursor', )
        if ('ribbon' in svl) {
            var cursorImagePaths = svl.misc.getLabelCursorImagePath(),
                labelType = svl.ribbon.getStatus('mode');
            if (labelType) {
                var cursorImagePath = cursorImagePaths[labelType].cursorImagePath;
                var cursorUrl = "url(" + cursorImagePath + ") 15 15, auto";

                if (rightClickMenu && rightClickMenu.isAnyOpen()) {
                    cursorUrl = 'default';
                }

                $(this).css('cursor', cursorUrl);
            }
        } else {
            throw self.className + ': Import the RibbonMenu.js and instantiate it!';
        }


        if (!status.drawing) {
            var ret = isOn(mouseStatus.currX, mouseStatus.currY);
            if (ret && ret.className === 'Path') {
                showLabelTag(status.currentLabel);
                ret.renderBoundingBox(ctx);
            } else {
                showLabelTag(undefined);
            }
        }
        clear();
        render2();
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     */
    function imageCoordinates2String (coordinates) {
        if (!(coordinates instanceof Array)) {
            throw self.className + '.imageCoordinates2String() expects Array as an input';
        }
        if (coordinates.length === 0) {
            throw self.className + '.imageCoordinates2String(): Empty array';
        }
        var ret = '';
        var i ;
        var len = coordinates.length;

        for (i = 0; i < len; i += 1) {
            ret += parseInt(coordinates[i].x) + ' ' + parseInt(coordinates[i].y) + ' ';
        }

        return ret;
    }

    /**
      * This is called when a user clicks a delete icon.
      */
    function labelDeleteIconClick () {
        if (!status.disableLabelDelete) {
            svl.tracker.push('Click_LabelDelete');
            var currLabel = self.getCurrentLabel();
            if (!currLabel) {
                //
                // Sometimes (especially during ground truth insertion if you force a delete icon to show up all the time),
                // currLabel would not be set properly. In such a case, find a label underneath the delete icon.
                var x = svl.ui.canvas.deleteIconHolder.css('left');
                var y = svl.ui.canvas.deleteIconHolder.css('top');
                x = x.replace("px", "");
                y = y.replace("px", "");
                x = parseInt(x, 10) + 5;
                y = parseInt(y, 10) + 5;
                var item = isOn(x, y);
                if (item && item.className === "Point") {
                    var path = item.belongsTo();
                    currLabel = path.belongsTo();
                } else if (item && item.className === "Label") {
                    currLabel = item;
                } else if (item && item.className === "Path") {
                    currLabel = item.belongsTo();
                }
            }

            if (currLabel) {
                svl.labelContainer.removeLabel(currLabel);
                svl.actionStack.push('deleteLabel', self.getCurrentLabel());
                svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');

                // If showLabelTag is blocked by GoldenInsertion (or by any other object), unlock it as soon as
                // a label is deleted.
                if (lock.showLabelTag) {
                    self.unlockShowLabelTag();
                }
            }
        }
    }

    /**
     * Render a temporary path while the user is drawing.
     */
    function renderTempPath() {
        if (!svl.ribbon) {
            // return if the ribbon menu is not correctly loaded.
            return false;
        }

        var pathLen = tempPath.length,
            labelColor = svl.misc.getLabelColors()[svl.ribbon.getStatus('selectedLabelType')],
            pointFill = labelColor.fillStyle,
            curr, prev, r;
        pointFill = svl.util.color.changeAlphaRGBA(pointFill, 0.5);


        // Draw the first line.
        ctx.strokeStyle = 'rgba(255,255,255,1)';
        ctx.lineWidth = 2;
        if (pathLen > 1) {
            curr = tempPath[1];
            prev = tempPath[0];
            r = Math.sqrt(Math.pow((tempPath[0].x - mouseStatus.currX), 2) + Math.pow((tempPath[0].y - mouseStatus.currY), 2));

            // Change the circle radius of the first point depending on the distance between a mouse cursor and the point coordinate.
            if (r < properties.radiusThresh && pathLen > 2) {
                svl.util.shape.lineWithRoundHead(ctx, prev.x, prev.y, 2 * properties.tempPointRadius, curr.x, curr.y, properties.tempPointRadius, 'both', 'rgba(255,255,255,1)', pointFill, 'none', 'rgba(255,255,255,1)', pointFill);
            } else {
                svl.util.shape.lineWithRoundHead(ctx, prev.x, prev.y, properties.tempPointRadius, curr.x, curr.y, properties.tempPointRadius, 'both', 'rgba(255,255,255,1)', pointFill, 'none', 'rgba(255,255,255,1)', pointFill);
            }
        }

        // Draw the lines in between
        for (var i = 2; i < pathLen; i++) {
            curr = tempPath[i];
            prev = tempPath[i-1];
            svl.util.shape.lineWithRoundHead(ctx, prev.x, prev.y, 5, curr.x, curr.y, 5, 'both', 'rgba(255,255,255,1)', pointFill, 'none', 'rgba(255,255,255,1)', pointFill);
        }

        if (r < properties.radiusThresh && pathLen > 2) {
            svl.util.shape.lineWithRoundHead(ctx, tempPath[pathLen-1].x, tempPath[pathLen-1].y, properties.tempPointRadius, tempPath[0].x, tempPath[0].y, 2 * properties.tempPointRadius, 'both', 'rgba(255,255,255,1)', pointFill, 'none', 'rgba(255,255,255,1)', pointFill);
        } else {
            svl.util.shape.lineWithRoundHead(ctx, tempPath[pathLen-1].x, tempPath[pathLen-1].y, properties.tempPointRadius, mouseStatus.currX, mouseStatus.currY, properties.tempPointRadius, 'both', 'rgba(255,255,255,1)', pointFill, 'stroke', 'rgba(255,255,255,1)', pointFill);
        }
    }

    /**
     * Cancel drawing while use is drawing a label
     * @method
     */
    function cancelDrawing () {
        // This method clears a tempPath and cancels drawing. This method is called by Keyboard when esc is pressed.
        if ('tracker' in svl && svl.tracker && status.drawing) {
            svl.tracker.push("LabelingCanvas_CancelLabeling");
        }

        tempPath = [];
        status.drawing = false;
        self.clear().render2();
        return this;
    }

    /**
     * Clear what's on the canvas.
     * @method
     */
    function clear () {
        // Clears the canvas
        if (ctx) {
          ctx.clearRect(0, 0, canvasProperties.width, canvasProperties.height);
        } else {
          console.warn('The ctx is not set.')
        }
        return this;
    }

    /**
     *
     * @method
     */
    function disableLabelDelete () {
        if (!status.lockDisableLabelDelete) {
            status.disableLabelDelete = true;
            return this;
        }
        return false;
    }

    /**
     * @method
     * @return {boolean}
     */
    function disableLabelEdit () {
       if (!status.lockDisableLabelEdit) {
           status.disableLabelEdit = true;
           return this;
       }
       return false;
    }

    /**
     * Disable labeling
     * @method
     */
    function disableLabeling () {
        // Check right-click-menu visibility
        // If any of menu is visible, disable labeling
        if (!status.lockDisableLabeling) {
            status.disableLabeling = true;
            /*
            var menuOpen = rightClickMenu.isAnyOpen();
            if (menuOpen) {
                status.disableLabeling = true;
            } else {
                status.disableLabeling = false;
            }
            */
            return this;
        }
        return false;
    }

    /**
     * Enable deleting labels
     * @method
     */
    function enableLabelDelete () {
        if (!status.lockDisableLabelDelete) {
            status.disableLabelDelete = false;
            return this;
        }
        return false;
    }

    /**
     * Enables editing labels
     * @method
     */
    function enableLabelEdit () {
        if (!status.lockDisableLabelEdit) {
            status.disableLabelEdit = false;
            return this;
        }
        return false;
    }

    /**
     * Enables labeling
     * @method
     */
    function enableLabeling () {
        if (!status.lockDisableLabeling) {
            status.disableLabeling = false;
            return this;
        }
        return false;
    }

    /**
     * Returns the label of the current focus
     * @method
     */
    function getCurrentLabel () {
        return status.currentLabel;
    }

    /**
     * Get labels stored in this canvas.
     * @method
     */
    function getLabels (target) {
        // This method returns a deepcopy of labels stored in this canvas.
        if (!target) {
            target = 'user';
        }

        if (target === 'system') {
            return self.getSystemLabels(false);
        } else {
            return self.getUserLabels(false);
        }
    }

    /**
     * Returns a lock that corresponds to the key.
     * @method
     */
    function getLock (key) { return lock[key]; }

    /**
     * Returns a number of labels in the current panorama.
     * @method
     */
    function getNumLabels () {
        var labels = svl.labelContainer.getCanvasLabels();
        var len = labels.length;
        var i, total = 0;
        for (i =0; i < len; i++) {
            if (!labels[i].isDeleted() && labels[i].isVisible()) {
                total++;
            }
        }
        return total;
    }

    /**
     * @method
     */
    function getRightClickMenu () { return rightClickMenu; }

    /**
     * Returns a status
     * @method
     */
    function getStatus (key) {
      if (!(key in status)) {
        console.warn("You have passed an invalid key for status.")
      }
        return status[key];
    }

    /**
     * This method returns system labels; the labels stored in our database (e.g., other users' labels and the user's
     * previous labels) that are not from this auditing session.
     * If refrence is true, then it returns reference to the labels.
     * Otherwise it returns deepcopy of labels.
     * @method
     */
    function getSystemLabels (reference) {
        if (!reference) { reference = false; }
        return reference ? systemLabels : $.extend(true, [], systemLabels);
    }

    /**
     * @method
     */
    function getUserLabelCount () {
        var labels = self.getUserLabels();
        labels = labels.filter(function (label) {
            return !label.isDeleted() && label.isVisible();
        });
        return labels.length;
    }

    /**
     * Returns user labels (i.e., what the user labeled during this session.)
     * If reference is true, then it returns reference to the labels. Otherwise it returns deepcopy of labels.
     * @method
     */
    function getUserLabels (reference) {
        if (!reference) { reference = false; }
        return reference ? svl.labelContainer.getCanvasLabels() : $.extend(true, [], svl.labelContainer.getCanvasLabels());
    }

    /**
     * Hide the delete label
     * @method
     */
    function hideDeleteLabel () {
        rightClickMenu.hideDeleteLabel();
        return this;
    }

    /**
     * Hide the right click menu
     * @returns {hideRightClickMenu}
     */
    function hideRightClickMenu () {
        rightClickMenu.hideBusStopType();
        rightClickMenu.hideBusStopPosition();
        return this;
    }

    /**
     * This method takes a label data (i.e., a set of point coordinates, label types, etc) and
     * and insert it into the labels array so the Canvas will render it
     * @method
     */
    function insertLabel (labelPoints, target) {
        if (!target) { target = 'user'; }

        var pointData, pov, point, path, param = {},
            labelColors = svl.misc.getLabelColors(),
            labelDescriptions = svl.misc.getLabelDescriptions(),
            iconImagePaths = svl.misc.getIconImagePaths(),
            length = labelPoints.length,
            points = [];


        for (var i = 0; i < length; i += 1) {
            pointData = labelPoints[i];
            pov = {
                heading: pointData.originalHeading,
                pitch: pointData.originalPitch,
                zoom: pointData.originalZoom
            };
            point = new Point();

            if ('PhotographerHeading' in pointData && pointData.PhotographerHeading &&
                'PhotographerPitch' in pointData && pointData.PhotographerPitch) {
                point.setPhotographerPov(parseFloat(pointData.PhotographerHeading), parseFloat(pointData.PhotographerPitch));
            }

            point.resetSVImageCoordinate({
                x: parseInt(pointData.svImageX, 10),
                y: parseInt(pointData.svImageY, 10)
            });


            point.setProperties({
                fillStyleInnerCircle : labelColors[pointData.LabelType].fillStyle,
                lineWidthOuterCircle : 2,
                iconImagePath : iconImagePaths[pointData.LabelType].iconImagePath,
                originalCanvasCoordinate: pointData.originalCanvasCoordinate,
                originalHeading: pointData.originalHeading,
                originalPitch: pointData.originalPitch,
                originalZoom: pointData.originalZoom,
                pov: pov,
                radiusInnerCircle : properties.pointInnerCircleRadius,
                radiusOuterCircle : properties.pointOuterCircleRadius,
                strokeStyleOuterCircle : 'rgba(255,255,255,1)',
                storedInDatabase : false
            });

            points.push(point)
        }

        path = new Path(points);

        param.canvasWidth = svl.canvasWidth;
        param.canvasHeight = svl.canvasHeight;
        param.canvasDistortionAlphaX = svl.alpha_x;
        param.canvasDistortionAlphaY = svl.alpha_y;
        param.labelId = labelPoints[0].LabelId;
        param.labelerId = labelPoints[0].AmazonTurkerId;
        param.labelType = labelPoints[0].LabelType;
        param.labelDescription = labelDescriptions[param.labelType].text;
        param.labelFillStyle = labelColors[param.labelType].fillStyle;
        param.panoId = labelPoints[0].LabelGSVPanoramaId;
        param.panoramaLat = labelPoints[0].Lat;
        param.panoramaLng = labelPoints[0].Lng;
        param.panoramaHeading = labelPoints[0].heading;
        param.panoramaPitch = labelPoints[0].pitch;
        param.panoramaZoom = labelPoints[0].zoom;

        param.svImageWidth = svl.svImageWidth;
        param.svImageHeight = svl.svImageHeight;
        param.svMode = 'html4';

        if (("PhotographerPitch" in labelPoints[0]) && ("PhotographerHeading" in labelPoints[0])) {
            param.photographerHeading = labelPoints[0].PhotographerHeading;
            param.photographerPitch = labelPoints[0].PhotographerPitch;
        }

        var newLabel = svl.labelFactory.create(path, param);

        if (target === 'system') {
            systemLabels.push(newLabel);
        } else {
            svl.labelContainer.push(newLabel);
        }
    }


    /**
     * This method returns the current status drawing.
     * @method
     * @return {boolean}
     */
    function isDrawing () { return status.drawing; }

    /**
     * This function takes cursor coordinates x and y on the canvas. Then returns an object right below the cursor.
     * If a cursor is not on anything, return false.
     * @method
     */
    function isOn (x, y) {
        var i, ret = false,
            labels = svl.labelContainer.getCanvasLabels(),
            lenLabels = labels.length;

        for (i = 0; i < lenLabels; i += 1) {
            // Check labels, paths, and points to see if they are under a mouse cursor
            ret = labels[i].isOn(x, y);
            if (ret) {
                status.currentLabel = labels[i];
                return ret;
            }
        }
        return false;
    }

    /**
     * @method
     */
    function lockCurrentLabel () {
        status.lockCurrentLabel = true;
        return this;
    }

    /**
     * Lock disable label delete
     * @method
     */
    function lockDisableLabelDelete () {
        status.lockDisableLabelDelete = true;
        return this;
    }

    /**
     * Lock disable label edit
     * @method
     */
    function lockDisableLabelEdit () {
        status.lockDisableLabelEdit = true;
        return this;
    }

    /**
     * Lock disable labeling
     * @method
     */
    function lockDisableLabeling () {
        status.lockDisableLabeling = true;
        return this;
    }

    /**
     * This method locks showLabelTag
     * @method
     */
    function lockShowLabelTag () {
        lock.showLabelTag = true;
        return this;
    }

    /**
     * @method
     */
    function pushLabel (label) {
        status.currentLabel = label;
        svl.labelContainer.push(label);
        if (svl.actionStack) {
            svl.actionStack.push('addLabel', label);
        }
        return this;
    }

    /**
     * This method removes all the labels stored in the labels array.
     * @method
     */
    function removeAllLabels () {
        if ("labelContainer" in svl) {
            svl.labelContainer.removeAll();
        }
        return this;
    }


    /**
     * Renders labels
     * @method
     */
    function render2 () {
        if (!ctx) { return this; }
        var i, j, label, lenLabels,
            labels = svl.labelContainer.getCanvasLabels();
        var labelCount = {
            Landmark_Bench : 0,
            Landmark_Shelter: 0,
            Landmark_TrashCan: 0,
            Landmark_MailboxAndNewsPaperBox: 0,
            Landmark_OtherPole: 0,
            StopSign : 0,
            CurbRamp: 0,
            NoCurbRamp: 0
        };
        status.totalLabelCount = 0;
        var pov = svl.map.getPov();


        var points, pointsLen, pointData, svImageCoordinate, deltaHeading, deltaPitch, x, y;
        // The image coordinates of the points in system labels shift as the projection parameters (i.e., heading and pitch) that
        // you can get from Street View API change. So adjust the image coordinate
        // Note that this adjustment happens only once
        if (!status.svImageCoordinatesAdjusted) {
            var currentPhotographerPov = svl.panorama.getPhotographerPov();
            if (currentPhotographerPov && 'heading' in currentPhotographerPov && 'pitch' in currentPhotographerPov) {
                lenLabels = labels.length;
                for (i = 0; i < lenLabels; i += 1) {
                    // Check if the label comes from current SV panorama
                    label = labels[i];
                    points = label.getPoints(true);
                    pointsLen = points.length;

                    for (j = 0; j < pointsLen; j++) {
                        pointData = points[j].getProperties();
                        svImageCoordinate = points[j].getGSVImageCoordinate();
                        if ('photographerHeading' in pointData && pointData.photographerHeading) {
                            deltaHeading = currentPhotographerPov.heading - pointData.photographerHeading;
                            deltaPitch = currentPhotographerPov.pitch - pointData.photographerPitch;
                            x = (svImageCoordinate.x + (deltaHeading / 360) * svl.svImageWidth + svl.svImageWidth) % svl.svImageWidth;
                            y = svImageCoordinate.y + (deltaPitch / 90) * svl.svImageHeight;
                            points[j].resetSVImageCoordinate({ x: x, y: y })
                        }
                    }
                }

                // Adjust system labels
                lenLabels = systemLabels.length;
                for (i = 0; i < lenLabels; i += 1) {
                    // Check if the label comes from current SV panorama
                    label = systemLabels[i];
                    points = label.getPoints(true);
                    pointsLen = points.length;

                    for (j = 0; j < pointsLen; j++) {
                        pointData = points[j].getProperties();
                        svImageCoordinate = points[j].getGSVImageCoordinate();
                        if ('photographerHeading' in pointData && pointData.photographerHeading) {
                            deltaHeading = currentPhotographerPov.heading - pointData.photographerHeading;
                            deltaPitch = currentPhotographerPov.pitch - pointData.photographerPitch;
                            x = (svImageCoordinate.x + (deltaHeading / 360) * svl.svImageWidth + svl.svImageWidth) % svl.svImageWidth;
                            y = svImageCoordinate.y + (deltaPitch / 180) * svl.svImageHeight;
                            points[j].resetSVImageCoordinate({x: x, y: y})
                        }
                    }
                }
                status.svImageCoordinatesAdjusted = true;
            }
        }

        // Render user labels. First check if the label comes from current SV panorama
        lenLabels = labels.length;
        for (i = 0; i < lenLabels; i += 1) {
            label = labels[i];
            label.render(ctx, pov);

            if (label.isVisible() && !label.isDeleted()) {
                labelCount[label.getLabelType()] += 1;
                status.totalLabelCount += 1;
            }
        }

        // Render system labels. First check if the label comes from current SV panorama
        lenLabels = systemLabels.length;
        for (i = 0; i < lenLabels; i += 1) {
            label = systemLabels[i];

            if (properties.evaluationMode) {
                label.render(ctx, pov, true);
            } else {
                label.render(ctx, pov);
            }
        }

        // Draw a temporary path from the last point to where a mouse cursor is.
        if (status.drawing) { renderTempPath(); }

        // Update the landmark counts on the right side of the interface.
        if (svl.labeledLandmarkFeedback) { svl.labeledLandmarkFeedback.setLabelCount(labelCount); }

        // Update the opacity of undo and redo buttons.
        if (svl.actionStack) { svl.actionStack.updateOpacity(); }

        // Update the opacity of Zoom In and Zoom Out buttons.
        if (svl.zoomControl) { svl.zoomControl.updateOpacity(); }

        // This like of code checks if the golden insertion code is running or not.
        if ('goldenInsertion' in svl && svl.goldenInsertion) { svl.goldenInsertion.renderMessage(); }

        return this;
    }

    /**
     * @method
     */
    function renderBoundingBox (path) {
        path.renderBoundingBox(ctx);
        return this;
    }

    /**
     * @method
     */
    function setCurrentLabel (label) {
        if (!status.lockCurrentLabel) {
            status.currentLabel = label;
            return this;
        }
        return false;
    }

    /**
     * This sets the status of the canvas object
     * @param key
     * @param value
     * @returns {*}
     */
    function setStatus (key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    /**
     * @method
     */
    function showLabelTag (label) {
        // This function sets the passed label's tagVisiblity to 'visible' and all the others to
        // 'hidden'.
        if (!lock.showLabelTag) {
            var i,
                labels = svl.labelContainer.getCanvasLabels(),
                labelLen = labels.length;
            var isAnyVisible = false;
            for (i = 0; i < labelLen; i += 1) {
                labels[i].setTagVisibility('hidden');
                labels[i].resetTagCoordinate();
            }
            if (label) {
                label.setTagVisibility('visible');
                isAnyVisible = true;
            } else {
                svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
            }
            // If any of the tags is visible, show a deleting icon on it.
            if (!isAnyVisible) {
                svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
            }
            self.clear().render2();
            return this;
        }
    }

    /**
     * @method
     */
    function setTagVisibility (labelIn) { return self.showLabelTag(labelIn); }

    /**
     * @method
     */
    function setVisibility (visibility) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;

        for (var i = 0; i < labelLen; i += 1) {
            labels[i].unlockVisibility().setVisibility('visible');
        }
        return this;
    }

    /**
     * Set the visibility of the labels based on pano id.
     */
    function setVisibilityBasedOnLocation (visibility, panoramaId) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;

        for (var i = 0; i < labelLen; i += 1) {
            labels[i].setVisibilityBasedOnLocation(visibility, panoramaId);
        }
        return this;
    }

    /**
     * Hide labels that are not in LabelerIds
     * @method
     */
    function setVisibilityBasedOnLabelerId (visibility, LabelerIds, included) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;

        for (var i = 0; i < labelLen; i += 1) {
            labels[i].setVisibilityBasedOnLabelerId(visibility, LabelerIds, included);
        }
        return this;
    }

    /**
     * @method
     */
    function setVisibilityBasedOnLabelerIdAndLabelTypes (visibility, table, included) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;
        for (var i = 0; i < labelLen; i += 1) {
            labels[i].setVisibilityBasedOnLabelerIdAndLabelTypes(visibility, table, included);
        }
        return this;
    }

    /**
     * @method
     */
    function showDeleteLabel (x, y) { rightClickMenu.showDeleteLabel(x, y); }

    /**
     * @method
     */
    function unlockCurrentLabel () {
        status.lockCurrentLabel = false;
        return this;
    }

    /**
     * @method
     */
    function unlockDisableLabelDelete () {
        status.lockDisableLabelDelete = false;
        return this;
    }

    /**
     * @method
     */
    function unlockDisableLabelEdit () {
        status.lockDisableLabelEdit = false;
        return this;
    }

    /**
     * @method
     */
    function unlockDisableLabeling () {
        status.lockDisableLabeling = false;
        return this;
    }

    /**
     * @method
     */
    function unlockShowLabelTag () {
        // This method locks showLabelTag
        lock.showLabelTag = false;
        return this;
    }

    // Initialization
    _init(param);

    // Put public methods to self and return them.
    self.cancelDrawing = cancelDrawing;
    self.clear = clear;
    self.disableLabelDelete = disableLabelDelete;
    self.disableLabelEdit = disableLabelEdit;
    self.disableLabeling = disableLabeling;
    self.enableLabelDelete = enableLabelDelete;
    self.enableLabelEdit = enableLabelEdit;
    self.enableLabeling = enableLabeling;
    self.getCurrentLabel = getCurrentLabel;
    self.getLabels = getLabels;
    self.getLock = getLock;
    self.getNumLabels = getNumLabels;
    self.getRightClickMenu = getRightClickMenu;
    self.getStatus = getStatus;
    self.getSystemLabels = getSystemLabels;
    self.getUserLabelCount = getUserLabelCount;
    self.getUserLabels = getUserLabels;
    self.hideDeleteLabel = hideDeleteLabel;
    self.hideRightClickMenu = hideRightClickMenu;
    self.insertLabel = insertLabel;
    self.isDrawing = isDrawing;
    self.isOn = isOn;
    self.lockCurrentLabel = lockCurrentLabel;
    self.lockDisableLabelDelete = lockDisableLabelDelete;
    self.lockDisableLabelEdit = lockDisableLabelEdit;
    self.lockDisableLabeling = lockDisableLabeling;
    self.lockShowLabelTag = lockShowLabelTag;
    self.pushLabel = pushLabel;
    self.removeAllLabels = removeAllLabels;
    self.render = render2;
    self.render2 = render2;
    self.renderBoundingBox = renderBoundingBox;
    self.setCurrentLabel = setCurrentLabel;
    self.setStatus = setStatus;
    self.showLabelTag = showLabelTag;
    self.setTagVisibility = setTagVisibility;
    self.setVisibility = setVisibility;
    self.setVisibilityBasedOnLocation = setVisibilityBasedOnLocation;
    self.setVisibilityBasedOnLabelerId = setVisibilityBasedOnLabelerId;
    self.setVisibilityBasedOnLabelerIdAndLabelTypes = setVisibilityBasedOnLabelerIdAndLabelTypes;
    self.showDeleteLabel = showDeleteLabel;
    self.unlockCurrentLabel = unlockCurrentLabel;
    self.unlockDisableLabelDelete = unlockDisableLabelDelete;
    self.unlockDisableLabelEdit = unlockDisableLabelEdit;
    self.unlockDisableLabeling = unlockDisableLabeling;
    self.unlockShowLabelTag = unlockShowLabelTag;

    return self;
}

/**
 * Compass module
 * @param d3 d3 module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Compass (d3, turf) {
    "use strict";
    var self = { className : 'Compass' },
        blinkInterval;

    var imageDirectories = {
        leftTurn: svl.rootDirectory + 'img/icons/ArrowLeftTurn.png',
        rightTurn: svl.rootDirectory + 'img/icons/ArrowRightTurn.png',
        slightLeft: svl.rootDirectory + 'img/icons/ArrowSlightLeft.png',
        slightRight: svl.rootDirectory + 'img/icons/ArrowSlightRight.png',
        straight: svl.rootDirectory + 'img/icons/ArrowStraight.png',
        uTurn: svl.rootDirectory + 'img/icons/ArrowUTurn.png'
    };

    var height = 50, width = 50, padding = { top: 5, right: 5, bottom: 5, left: 5 },
        el = d3.select('#compass-holder'),
        svg = el.append('svg'),
        chart = svg.append('g'),
        needle;

    function _init() {
        svg.attr('width', width + padding.left + padding.right)
            .attr('height', height + padding.top + padding.bottom + 30)
            .style({ position: 'absolute', left: 0, top: 0 });

        // chart.transition(100).attr('transform', 'translate(' + (height / 2 + padding.top) + ', ' + (width / 2 + padding.bottom) + ')');
        // needle = chart.append('path')
        //         .attr('d', 'M 0 -' + (width / 2 - 3) + ' L 10 9 L 0 6 L -10 9 z')
        //         .attr('fill', 'white')
        //         .attr('stroke', 'white')
        //         .attr('stroke-width', 1);
    }

    /**
     * Mapping from an angle to a direction
     * @param angle
     * @returns {*}
     */
    function angleToDirection (angle) {
        angle = (angle + 360) % 360;
        if (angle < 20 || angle > 340)
            return "straight";
        else if (angle >= 20 && angle < 45)
            return "slight-left";
        else if (angle <= 340 && angle > 315)
            return "slight-right";
        else if (angle >= 35 && angle < 150)
            return "left";
        else if (angle <= 315 && angle > 210)
            return "right";
        else if (angle <= 210 && angle >= 150) {
            return "u-turn";
        }
        else {
            console.debug("It shouldn't reach here.");
        }
    }

    /**
     * Blink the compass message
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            svl.ui.compass.messageHolder.toggleClass("white-background-75");
            svl.ui.compass.messageHolder.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Check if the user is following the route that we specified
     * @param threshold
     * @param unit
     * @returns {boolean}
     */
    function checkEnRoute (threshold, unit) {
        var task = svl.taskContainer.getCurrentTask();
        if (!unit) unit = "kilometers";
        if (!threshold) threshold = 0.05;  // 50 m

        if (task) {
            var geojson = task.getGeoJSON(),
                latlng = svl.map.getPosition(),
                line = geojson.features[0],
                currentPoint = turf.point([latlng.lng, latlng.lat]),
                snapped = turf.pointOnLine(line, currentPoint);
            return turf.distance(currentPoint, snapped, unit) < threshold;
        }
        return true;
    }

    /**
     * Mapping from direction to a description of the direction
     * @param direction
     * @returns {*}
     */
    function directionToDirectionMessage(direction) {
        switch (direction) {
            case "straight":
                return "Walk straight";
            case "slight-right":
                return "Turn slightly towards right";
            case "slight-left":
                return "Turn slightly towards left";
            case "right":
                return "Turn right";
            case "left":
                return "Turn left";
            case "u-turn":
                return "U turn";
            default:
        }
    }

    /**
     * Mapping from a direction to an image path of direction icons.
     * @param direction
     * @returns {string|*}
     */
    function directionToImagePath(direction) {
        switch (direction) {
            case "straight":
                return imageDirectories.straight;
            case "slight-right":
                return imageDirectories.slightRight;
            case "slight-left":
                return imageDirectories.slightLeft;
            case "right":
                return imageDirectories.rightTurn;
            case "left":
                return imageDirectories.leftTurn;
            case "u-turn":
                return imageDirectories.uTurn;
            default:
        }
    }

    /**
     * Get the angle to the next goal.
     * @returns {number}
     */
    function getTargetAngle () {
        var task = svl.taskContainer.getCurrentTask(),
            latlng = svl.map.getPosition(),  // current position
            geometry = task.getGeometry(),  // get the street geometry of the current task
            coordinates = geometry.coordinates,  // get the latlng coordinates of the streets
            distArray = coordinates.map(function(o) { return Math.sqrt(norm(latlng.lat, latlng.lng, o[1], o[0])); }),
            minimum = Math.min.apply(Math, distArray),
            argmin = distArray.indexOf(minimum),
            argTarget;
        argTarget = (argmin < (coordinates.length - 1)) ? argmin + 1 : geometry.coordinates.length - 1;

        return svl.util.math.toDegrees(Math.atan2(coordinates[argTarget][0] - latlng.lng, coordinates[argTarget][1] - latlng.lat));
    }

    /**
     * Get the compass angle
     * @returns {number}
     */
    function getCompassAngle () {
        var heading = svl.map.getPov().heading, targetAngle = getTargetAngle();
        return heading - targetAngle;
    }

    /**
     * Hide a message
     */
    function hideMessage () {
        svl.ui.compass.messageHolder.removeClass("fadeInUp").addClass("fadeOutDown");
    }

    /**
     * Return the sum of square of lat and lng diffs
     * */
    function norm (lat1, lng1, lat2, lng2) {
        return Math.pow(lat2 - lat1, 2) + Math.pow(lng2 - lng1, 2);
    }

    /**
     * Set the compass message.
     */
    function setTurnMessage () {
        var image, message,
            angle = getCompassAngle(),
            direction = angleToDirection(angle);

        image = "<img src='" + directionToImagePath(direction) + "' class='compass-turn-images' alt='Turn icon' />";
        message =  "<span class='compass-message-small'>Do you see any unlabeled problems? If not,</span><br/>" + image + "<span class='bold'>" + directionToDirectionMessage(direction) + "</span>";
        // message =  image + "<span class='bold'>" + directionToDirectionMessage(direction) + "</span>";
        svl.ui.compass.message.html(message);
    }

    /**
     * Show a message
     */
    function showMessage () {
        svl.ui.compass.messageHolder.removeClass("fadeOutDown").addClass("fadeInUp");
    }

    /**
     * Stop blinking the compass message.
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        blinkInterval = null;
        svl.ui.compass.messageHolder.addClass("white-background-75");
        svl.ui.compass.messageHolder.removeClass("highlight-50");
    }

    /**
     * Update the compass visualization
     */
    function update () {
        var compassAngle = getCompassAngle(),
            cosine = Math.cos(compassAngle / 360 * 2 * Math.PI),
            val = (cosine + 1) / 2,
            r = 229 - 185 * val, g = 245 - 83 * val, b = 249 - 154 * val, rgb = 'rgb(' + r + ',' + g + ',' + b + ')';

        // http://colorbrewer2.org/ (229,245,249), (44,162,95)
        if (needle && chart) {
            needle.transition(100)
                .attr('fill', rgb);
            chart.transition(100)
                .attr('transform', 'translate(' + (height / 2 + padding.top) + ', ' + (width / 2 + padding.left) + ') rotate(' + (-compassAngle) + ')');
        }

        setTurnMessage();

        if (checkEnRoute()) {
            stopBlinking();
        } else {
            blink();
        }
    }

    /**
     * Update the message
     * @param streetName
     */
    function updateMessage (streetName) {
        setTurnMessage(streetName);
    }

    self.blink = blink;
    self.getCompassAngle = getCompassAngle;
    self.hideMessage = hideMessage;
    self.showMessage = showMessage;
    self.setTurnMessage = setTurnMessage;
    self.stopBlinking = stopBlinking;
    self.updateMessage = updateMessage;
    self.update = update;

    _init();
    return self;
}

/**
 * ContextMenu module
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ContextMenu ($) {
    var self = { className: "ContextMenu" },
        status = {
            targetLabel: null,
            visibility: 'hidden'
        };
    var $menuWindow = svl.ui.contextMenu.holder,
        $connector = svl.ui.contextMenu.connector,
        $radioButtons = svl.ui.contextMenu.radioButtons,
        $temporaryProblemCheckbox = svl.ui.contextMenu.temporaryProblemCheckbox,
        $descriptionTextBox = svl.ui.contextMenu.textBox,
        windowWidth = $menuWindow.width();

    document.addEventListener("mousedown", hide);
    $menuWindow.on('mousedown', handleMenuWindowMouseDown);
    $radioButtons.on('change', handleRadioChange);
    $temporaryProblemCheckbox.on('change', handleTemporaryProblemCheckboxChange);
    $descriptionTextBox.on('change', handleDescriptionTextBoxChange);
    $descriptionTextBox.on('focus', handleDescriptionTextBoxFocus);
    $descriptionTextBox.on('blur', handleDescriptionTextBoxBlur);
    svl.ui.contextMenu.closeButton.on('click', handleCloseButtonClick);


    /**
     * Returns a status
     * @param key
     * @returns {null}
     */
    function getStatus (key) {
        return (key in status) ? status[key] : null;
    }

    /**
     * Get the current target label
     * @returns {null}
     */
    function getTargetLabel () {
        return getStatus('targetLabel');
    }

    /**
     * Combined with document.addEventListener("mousedown", hide), this method will close the context menu window
     * when user clicks somewhere on the window except for the area on the context menu window.
     * @param e
     */
    function handleMenuWindowMouseDown (e) {
        e.stopPropagation();
    }

    function handleDescriptionTextBoxChange(e) {
        var description = $(this).val(),
            label = getTargetLabel();
        if (label) {
            label.setProperty('description', description);
        }
    }

    function handleDescriptionTextBoxBlur() {
        svl.tracker.push('ContextMenu_TextBoxBlur');
        svl.ribbon.enableModeSwitch();
    }

    function handleDescriptionTextBoxFocus() {
        svl.tracker.push('ContextMenu_TextBoxFocus');
        svl.ribbon.disableModeSwitch();
    }

    function handleCloseButtonClick () {
        svl.tracker.push('ContextMenu_CloseButtonClick');
        hide();
    }
    /**
     *
     * @param e
     */
    function handleRadioChange (e) {
        var severity = parseInt($(this).val(), 10),
            label = getTargetLabel();
        svl.tracker.push('ContextMenu_RadioChange', { LabelType: label.getProperty("labelType"), RadioValue: severity });

        if (label) {
            label.setProperty('severity', severity);
        }
    }

    /**
     *
     * @param e
     */
    function handleTemporaryProblemCheckboxChange (e) {
        var checked = $(this).is(":checked"),
            label = getTargetLabel();
        svl.tracker.push('ContextMenu_CheckboxChange', { checked: checked });

        if (label) {
            label.setProperty('temporaryProblem', checked);
        }
    }

    /**
     * Hide the context menu
     * @returns {hide}
     */
    function hide () {
        $menuWindow.css('visibility', 'hidden');
        setBorderColor('black');
        setStatus('visibility', 'hidden');
        return this;
    }

    /**
     * Checks if the menu is open or not
     * @returns {boolean}
     */
    function isOpen() {
        return getStatus('visibility') == 'visible';
    }

    /**
     * Set the border color of the menu window
     * @param color
     */
    function setBorderColor(color) {
        $menuWindow.css('border-color', color);
        $connector.css('background-color', color);
    }

    /**
     * Sets a status
     * @param key
     * @param value
     * @returns {setStatus}
     */
    function setStatus (key, value) {
        status[key] = value;
        return this;
    }

    /**
     * Show the context menu
     * @param x x-coordinate on the canvas pane
     * @param y y-coordinate on the canvas pane
     * @param param a parameter object
     */
    function show (x, y, param) {
        setStatus('targetLabel', null);
        $radioButtons.prop('checked', false);
        $temporaryProblemCheckbox.prop('checked', false);
        $descriptionTextBox.val(null);
        if (x && y && ('targetLabel' in param)) {
            var labelType = param.targetLabel.getLabelType(),
                acceptedLabelTypes = ['SurfaceProblem', 'Obstacle', 'NoCurbRamp', 'Other', 'CurbRamp'];
            if (acceptedLabelTypes.indexOf(labelType) != -1) {
                setStatus('targetLabel', param.targetLabel);
                $menuWindow.css({
                    visibility: 'visible',
                    left: x - windowWidth / 2,
                    top: y + 20
                });

                if (param) {
                    if ('targetLabelColor' in param) { setBorderColor(param.targetLabelColor); }
                }
                setStatus('visibility', 'visible');

                // Set the menu value if label has it's value set.
                var severity = param.targetLabel.getProperty('severity'),
                    temporaryProblem = param.targetLabel.getProperty('temporaryProblem'),
                    description = param.targetLabel.getProperty('description');
                if (severity) {
                    $radioButtons.each(function (i, v) {
                       if (severity == i + 1) { $(this).prop("checked", true); }
                    });
                }

                if (temporaryProblem) {
                    $temporaryProblemCheckbox.prop("checked", temporaryProblem);
                }

                if (description) {
                    $descriptionTextBox.val(description);
                } else {
                    var example = '', defaultText = "Description";
                    if (labelType == 'CurbRamp') {
                        example = " (e.g., narrow curb ramp)";
                    } else if (labelType == 'NoCurbRamp') {
                        example = "";
                    } else if (labelType == 'Obstacle') {
                        example = " (e.g., sidewalk construction)";
                    } else if (labelType == 'SurfaceProblem') {
                        example = " (e.g., a leveled surface due to a tree root)";
                    }
                    $descriptionTextBox.prop("placeholder", defaultText + example);
                }
            }
        }
    }

    self.hide = hide;
    self.isOpen = isOpen;
    self.show = show;
    return self;
}
/**
 * A form module. This module is responsible for communicating with the server side for submitting collected data.
 * @param $ {object} jQuery object
 * @param params {object} Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Form ($, params) {
    var self = { className : 'Form'},
        properties = {
            commentFieldMessage: undefined,
            isAMTTask : false,
            isPreviewMode : false,
            previousLabelingTaskId: undefined,
            dataStoreUrl : undefined,
            taskRemaining : 0,
            taskDescription : undefined,
            taskPanoramaId: undefined,
            hitId : undefined,
            assignmentId: undefined,
            turkerId: undefined,
            userExperiment: false
        },
        status = {
            disabledButtonMessageVisibility: 'hidden',
            disableSkipButton : false,
            disableSubmit : false,
            radioValue: undefined,
            skipReasonDescription: undefined,
            submitType: undefined,
            taskDifficulty: undefined,
            taskDifficultyComment: undefined
        },
        lock = {
            disableSkipButton : false,
            disableSubmit : false
        };

    function _init (params) {
        var params = params || {};
        var hasGroupId = getURLParameter('groupId') !== "";
        var hasHitId = getURLParameter('hitId') !== "";
        var hasWorkerId = getURLParameter('workerId') !== "";
        var assignmentId = getURLParameter('assignmentId');

        properties.dataStoreUrl = "dataStoreUrl" in params ? params.dataStoreUrl : null;

        if (('assignmentId' in params) && params.assignmentId &&
            ('hitId' in params) && params.hitId &&
            ('turkerId' in params) && params.turkerId
        ) {
            properties.assignmentId = params.assignmentId;
            properties.hitId = params.hitId;
            properties.turkerId = params.turkerId;
            $('input[name="assignmentId"]').attr('value', properties.assignmentId);
            $('input[name="workerId"]').attr('value', properties.turkerId);
            $('input[name="hitId"]').attr('value', properties.hitId);
        }

        if (assignmentId && assignmentId === 'ASSIGNMENT_ID_NOT_AVAILABLE') {
            properties.isPreviewMode = true;
            properties.isAMTTask = true;
            unlockDisableSubmit().disableSubmit().lockDisableSubmit();
            unlockDisableSkip().disableSkip().lockDisableSkip();
        } else if (hasWorkerId && !assignmentId) {
            properties.isPreviewMode = false;
            properties.isAMTTask = false;
        } else if (!assignmentId && !hasHitId && !hasWorkerId) {
            properties.isPreviewMode = false;
            properties.isAMTTask = false;
        } else {
            properties.isPreviewMode = false;
            properties.isAMTTask = true;
        }

        // Check if this is a sandbox task or not
        properties.isSandbox = false;
        if (properties.isAMTTask) {
            if (document.referrer.indexOf("workersandbox.mturk.com") !== -1) {
                properties.isSandbox = true;
                $form.prop("action", "https://workersandbox.mturk.com/mturk/externalSubmit");
            }
        }

        // Check if this is a preview and, if so, disable submission and show a message saying this is a preview.
        if (properties.isAMTTask && properties.isPreviewMode) {
            var dom = '<div class="amt-preview-warning-holder">' +
                '<div class="amt-preview-warning">' +
                'Warning: you are on a Preview Mode!' +
                '</div>' +
                '</div>';
            $("body").append(dom);
            disableSubmit();
            lockDisableSubmit();
        }

        //svl.ui.form.skipButton.on('click', handleSkipClick);
        //svl.ui.leftColumn.jump.on('click', handleSkipClick);
        //svl.ui.leftColumn.feedback.on('click', handleFeedbackClick);
    }

    /**
     * This method gathers all the data needed for submission.
     * @returns {{}}
     */
    function compileSubmissionData (task) {
        var i, j, len, data = {};

        data.audit_task = {
            street_edge_id: task.getStreetEdgeId(),
            task_start: task.getTaskStart(),
            audit_task_id: task.getAuditTaskId()
        };

        data.environment = {
            browser: svl.util.getBrowser(),
            browser_version: svl.util.getBrowserVersion(),
            browser_width: $(window).width(),
            browser_height: $(window).height(),
            screen_width: screen.width,
            screen_height: screen.height,
            avail_width: screen.availWidth,		// total width - interface (taskbar)
            avail_height: screen.availHeight,		// total height - interface };
            operating_system: svl.util.getOperatingSystem()
        };

        data.interactions = svl.tracker.getActions();
        svl.tracker.refresh();

        data.labels = [];
        var labels = svl.labelContainer.getCurrentLabels();
        for(i = 0; i < labels.length; i += 1) {
            var label = labels[i],
                prop = label.getProperties(),
                points = label.getPath().getPoints(),
                pathLen = points.length;

            var labelLatLng = label.toLatLng();
            var temp = {
                deleted : label.isDeleted(),
                label_id : label.getLabelId(),
                label_type : label.getLabelType(),
                photographer_heading : prop.photographerHeading,
                photographer_pitch : prop.photographerPitch,
                panorama_lat: prop.panoramaLat,
                panorama_lng: prop.panoramaLng,
                temporary_label_id: label.getProperty('temporary_label_id'),
                gsv_panorama_id : prop.panoId,
                label_points : [],
                severity: label.getProperty('severity'),
                temporary_problem: label.getProperty('temporaryProblem'),
                description: label.getProperty('description')
            };

            for (j = 0; j < pathLen; j += 1) {
                var point = points[j],
                    gsvImageCoordinate = point.getGSVImageCoordinate(),
                    pointParam = {
                        sv_image_x : gsvImageCoordinate.x,
                        sv_image_y : gsvImageCoordinate.y,
                        canvas_x: point.originalCanvasCoordinate.x,
                        canvas_y: point.originalCanvasCoordinate.y,
                        heading: point.originalPov.heading,
                        pitch: point.originalPov.pitch,
                        zoom : point.originalPov.zoom,
                        canvas_height : prop.canvasHeight,
                        canvas_width : prop.canvasWidth,
                        alpha_x : prop.canvasDistortionAlphaX,
                        alpha_y : prop.canvasDistortionAlphaY,
                        lat : labelLatLng.lat,
                        lng : labelLatLng.lng
                    };
                temp.label_points.push(pointParam);
            }

            data.labels.push(temp)
        }

        // Keep Street View meta data. This is particularly important to keep track of the date when the images were taken (i.e., the date of the accessibilty attributes).
        data.gsv_panoramas = [];
        if ("panoramaContainer" in svl && svl.panoramaContainer) {
            var temp,
                panoramaData,
                link,
                linksc,
                panoramas = svl.panoramaContainer.getStagedPanoramas();
            len = panoramas.length;

            for (i = 0; i < len; i++) {
                panoramaData = panoramas[i].data();
                links = [];

                if ("links" in panoramaData) {
                    for (j = 0; j < panoramaData.links.length; j++) {
                        link = panoramaData.links[j];
                        links.push({
                            target_gsv_panorama_id: ("pano" in link) ? link.pano : "",
                            yaw_deg: ("heading" in link) ? link.heading : 0.0,
                            description: ("description" in link) ? link.description : ""
                        });
                    }
                }

                temp = {
                    panorama_id: ("location" in panoramaData && "pano" in panoramaData.location) ? panoramaData.location.pano : "",
                    image_date: "imageDate" in panoramaData ? panoramaData.imageDate : "",
                    links: links,
                    copyright: "copyright" in panoramaData ? panoramaData.copyright : ""
                };

                data.gsv_panoramas.push(temp);
                panoramas[i].setProperty("submitted", true);
            }
        }

        return data;
    }
    

    /**
     * Disable clicking the submit button
     * @returns {*}
     */
    function disableSubmit () {
        if (!lock.disableSubmit) {
            status.disableSubmit = true;
            //  $btnSubmit.attr('disabled', true);
            //$btnSubmit.css('opacity', 0.5);
            return this;
        }
        return false;
    }

    /**
     * Disable clicking the skip button
     * @returns {*}
     */
    function disableSkip () {
        if (!lock.disableSkip) {
            status.disableSkip = true;
            // $btnSkip.attr('disabled', true);
            //$btnSkip.css('opacity', 0.5);
            return this;
        } else {
            return false;
        }
    }

    /**
     * Enable clicking the submit button
     * @returns {*}
     */
    function enableSubmit () {
        if (!lock.disableSubmit) {
            status.disableSubmit = false;
            return this;
        } else {
            return false;
        }
    }

    /**
     * Enable clicking the skip button
     * @returns {*}
     */
    function enableSkip () {
        if (!lock.disableSkip) {
            status.disableSkip = false;
            return this;
        } else {
            return false;
        }
    }

    /** This method returns whether the task is in preview mode or not. */
    function isPreviewMode () {
        return properties.isPreviewMode;
    }

    function lockDisableSubmit () {
        lock.disableSubmit = true;
        return this;
    }

    function lockDisableSkip () {
        lock.disableSkip = true;
        return this;
    }

    /**
     * Post a json object
     * @param url
     * @param data
     * @param callback
     * @param async
     */
    function postJSON (url, data, callback, async) {
        if (!async) async = true;
        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: url,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                if (callback) callback(result);
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    function setPreviousLabelingTaskId (val) {
        properties.previousLabelingTaskId = val;
        return this;
    }

    /** This method sets the taskDescription */
    function setTaskDescription (val) {
        properties.taskDescription = val;
        return this;
    }

    /** This method sets the taskPanoramaId. Note it is not same as the GSV panorama id. */
    function setTaskPanoramaId (val) {
        properties.taskPanoramaId = val;
        return this;
    }

    /** This method sets the number of remaining tasks */
    function setTaskRemaining (val) {
        properties.taskRemaining = val;
        return this;
    }

    /**
     * Submit the data collected so far and move to another location.
     * @param dataIn An object that has issue_description, lat, and lng as fields.
     * @returns {boolean}
     */
    function skipSubmit (dataIn) {
        var task = svl.taskContainer.getCurrentTask();
        var data = compileSubmissionData(task);
        data.incomplete = dataIn;
        svl.tracker.push('TaskSkip');
        submit(data, task);

        if ("taskContainer" in svl) {
            svl.taskContainer.initNextTask();
        }

        return false;
    }

    /**
     * Submit the data.
     * @param data This can be an object of a compiled data for auditing, or an array of
     * the auditing data.
     */
    function submit(data, task) {
        svl.tracker.push('TaskSubmit');
        svl.labelContainer.refresh();
        if (data.constructor !== Array) { data = [data]; }

        $.ajax({
            // async: false,
            contentType: 'application/json; charset=utf-8',
            url: properties.dataStoreUrl,
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                if (result) task.setProperty("auditTaskId", result.audit_task_id);
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    /** Unlock disable submit */
    function unlockDisableSubmit () {
        lock.disableSubmit = false;
        return this;
    }

    /** Unlock disable skip */
    function unlockDisableSkip () {
        lock.disableSkipButton = false;
        return this;
    }

    //self.checkSubmittable = checkSubmittable;
    self.compileSubmissionData = compileSubmissionData;
    self.disableSubmit = disableSubmit;
    self.disableSkip = disableSkip;
    self.enableSubmit = enableSubmit;
    self.enableSkip = enableSkip;
    self.isPreviewMode = isPreviewMode;
    self.lockDisableSubmit = lockDisableSubmit;
    self.lockDisableSkip = lockDisableSkip;
    self.postJSON = postJSON;
    self.setPreviousLabelingTaskId = setPreviousLabelingTaskId;
    self.setTaskDescription = setTaskDescription;
    self.setTaskRemaining = setTaskRemaining;
    self.setTaskPanoramaId = setTaskPanoramaId;
    self.skipSubmit = skipSubmit;
    self.unlockDisableSubmit = unlockDisableSubmit;
    self.unlockDisableSkip = unlockDisableSkip;
    self.submit = submit;
    _init(params);
    return self;
}

/**
 * A Keyboard module
 * @param $ jQuery
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Keyboard ($) {
    var self = {
            className : 'Keyboard'
        };
    var status = {
        focusOnTextField: false,
        shiftDown: false
    };

    var $textareaComment;

    function init () {
        if ('ui' in svl && 'form' in svl.ui) {
            $textareaComment = (svl.ui.form.commentField.length) > 0 ? svl.ui.form.commentField : null;
        }

        if ($textareaComment) {
          $textareaComment.bind('focus', textFieldFocus);
          $textareaComment.bind('blur', textFieldBlur);
        }


        $(document).bind('keyup', documentKeyUp);
        $(document).bind('keydown', documentKeyDown);
    }

    /**
     * This is a callback for a key down event
     * @param {object} e An event object
     * @private
     */
    function documentKeyDown(e) {
        // The callback method that is triggered with a keyUp event.
        if (!status.focusOnTextField) {
            switch (e.keyCode) {
                case 16:
                    // "Shift"
                    status.shiftDown = true;
                    break;
            }
        }
    }

    /**
     * This is a callback for a key up event.
     * @param {object} e An event object
     * @private
     */
    function documentKeyUp (e) {
        // console.log(e.keyCode);

        // This is a callback method that is triggered when a keyDown event occurs.
        if (!status.focusOnTextField) {
            // if ("contextMenu" in svl && svl.contextMenu) {
            //     svl.contextMenu.hide();
            // }

            switch (e.keyCode) {
                // "Enter"
                case 13:
                    if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
                        svl.contextMenu.hide();
                    }
                    break;
                case 16:
                    // "Shift"
                    status.shiftDown = false;
                    break;
                case 27:
                    // "Escape"
                    if (svl.canvas.getStatus('drawing')) {
                        svl.canvas.cancelDrawing();
                    } else {
                        svl.ribbon.backToWalk();
                    }
                    break;
                    case 49:
                    // "1"
                    if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
                        svl.ui.contextMenu.radioButtons.filter(function(){return this.value=='1'}).prop("checked", true).trigger("click");
                    }
                    else{
                        svl.ribbon.modeSwitchClick("CurbRamp");
                        break;
                    }
                    break;
                case 50:
                    // "2"
                    if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
                        svl.ui.contextMenu.radioButtons.filter(function(){return this.value=='2'}).prop("checked", true).trigger("click");
                    }
                    else{
                        svl.ribbon.modeSwitchClick("NoCurbRamp");
                    }
                    break;
                case 51:
                    // "3"
                    if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
                        svl.ui.contextMenu.radioButtons.filter(function(){return this.value=='3'}).prop("checked", true).trigger("click");
                    }
                    else{
                        svl.ribbon.modeSwitchClick("Obstacle");
                    }
                    break;
                case 52:
                    // "4"
                    if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
                        svl.ui.contextMenu.radioButtons.filter(function(){return this.value=='4'}).prop("checked", true).trigger("click");
                    }
                    else{
                        svl.ribbon.modeSwitchClick("SurfaceProblem");
                    }
                    break;
                case 53:
                    // "5"
                    if ('contextMenu' in svl && svl.contextMenu.isOpen()) {
                        svl.ui.contextMenu.radioButtons.filter(function(){return this.value=='5'}).prop("checked", true).trigger("click");
                    }
                    else{

                    }
                    break;
                case 66:
                    // "b" for a blocked view
                    svl.ribbon.modeSwitch("Occlusion");
                    break;
                case 67:
                    // "c" for CurbRamp. Switch the mode to the CurbRamp labeling mode.
                    svl.ribbon.modeSwitch("CurbRamp");
                    break;
                case 69:
                    // "e" for Explore. Switch the mode to Walk (camera) mode.
                    svl.ribbon.modeSwitch("Walk");
                    break;
                case 77:
                    // "m" for MissingCurbRamp. Switch the mode to the MissingCurbRamp labeling mode.
                    svl.ribbon.modeSwitch("NoCurbRamp");
                    break;
                case 78:
                    svl.ribbon.modeSwitch("NoSidewalk");
                    break;
                case 79:
                    // "o" for Obstacle
                    svl.ribbon.modeSwitch("Obstacle");
                    break;
                case 83:
                    svl.ribbon.modeSwitch("SurfaceProblem");
                    break;
                case 90:
                    // "z" for zoom. By default, it will zoom in. If "shift" is down, it will zoom out.
                    if (status.shiftDown) {
                        // Zoom out
                        if ("zoomControl" in svl) {
                            svl.zoomControl.zoomOut();
                        }
                    } else {
                        // Zoom in
                        if ("zoomControl" in svl)
                            svl.zoomControl.zoomIn();
                    }
            }
        }
    }

    /**
     * This is a callback function called when any of the text field is blurred.
     * @private
     */
    function textFieldBlur () {
        status.focusOnTextField = false
    }

    /**
     * This is a callback function called when any of the text field is focused.
     * @private
     */
    function textFieldFocus () {
        status.focusOnTextField = true;
    }

    /**
     * Get status
     * @param {string} key Field name
     * @returns {*}
     */
    function getStatus (key) {
        if (!(key in status)) {
            console.warn("You have passed an invalid key for status.")
        }
        return status[key];
    }

    /**
     * This method returns whether a shift key is currently pressed or not.
     * @returns {boolean}
     */
    function isShiftDown () {
        return status.shiftDown;
    }

    /**
     * Set status
     * @param key Field name
     * @param value Field value
     * @returns {setStatus}
     */
    function setStatus (key, value) {
        if (key in status) {
            status[key] = value;
        }
        return this;
    }


    self.getStatus = getStatus;
    self.isShiftDown = isShiftDown;
    self.setStatus = setStatus;

    init();
    return self;
}

/** @namespace */
var svl = svl || {};

/**
 * The main module of SVLabel
 * @param $: jQuery object
 * @param d3 D3 library
 * @param google Google Maps library
 * @param params: other parameters
 * @returns {{moduleName: string}}
 * @constructor
 * @memberof svl
 */
function Main ($, d3, google, turf, params) {
    var self = { className: 'Main' };
    var status = {
        isFirstTask: false
    };
    svl.rootDirectory = ('rootDirectory' in params) ? params.rootDirectory : '/';

    /**
     * Store jQuery DOM elements under svl.ui
     * @private
     */
    function _initUI () {
        svl.ui = {};
        svl.ui.actionStack = {};
        svl.ui.actionStack.holder = $("#action-stack-control-holder");
        svl.ui.actionStack.holder.append('<button id="undo-button" class="button action-stack-button" value="Undo"><img src="' + svl.rootDirectory + 'img/icons/Icon_Undo.png" class="action-stack-icons" alt="Undo" /><br /><small>Undo</small></button>');
        svl.ui.actionStack.holder.append('<button id="redo-button" class="button action-stack-button" value="Redo"><img src="' + svl.rootDirectory + 'img/icons/Icon_Redo.png" class="action-stack-icons" alt="Redo" /><br /><small>Redo</small></button>');
        svl.ui.actionStack.redo = $("#redo-button");
        svl.ui.actionStack.undo = $("#undo-button");

        svl.ui.counterHolder = $("#counter-holder");
        svl.ui.labelCounter = $("#label-counter");

        // Map DOMs
        svl.ui.map = {};
        svl.ui.map.canvas = $("canvas#labelCanvas");
        svl.ui.map.drawingLayer = $("div#labelDrawingLayer");
        svl.ui.map.pano = $("div#pano");
        svl.ui.map.streetViewHolder = $("div#streetViewHolder");
        svl.ui.map.viewControlLayer = $("div#viewControlLayer");
        svl.ui.map.modeSwitchWalk = $("span#modeSwitchWalk");
        svl.ui.map.modeSwitchDraw = $("span#modeSwitchDraw");
        svl.ui.googleMaps = {};
        svl.ui.googleMaps.holder = $("#google-maps-holder");
        svl.ui.googleMaps.overlay = $("#google-maps-overlay");

        // Status holder
        svl.ui.status = {};
        svl.ui.status.holder = $("#status-holder");
        
        svl.ui.status.neighborhoodLink = $("#status-neighborhood-link");
        svl.ui.status.currentMissionDescription = $("#current-mission-description");

        // MissionDescription DOMs
        svl.ui.statusMessage = {};
        svl.ui.statusMessage.holder = $("#current-status-holder");
        svl.ui.statusMessage.title = $("#current-status-title");
        svl.ui.statusMessage.description = $("#current-status-description");

        // OverlayMessage
        svl.ui.overlayMessage = {};
        svl.ui.overlayMessage.holder = $("#overlay-message-holder");
        svl.ui.overlayMessage.holder.append("<span id='overlay-message-box'><span id='overlay-message'>Walk</span></span>");
        svl.ui.overlayMessage.box = $("#overlay-message-box");
        svl.ui.overlayMessage.message = $("#overlay-message");

        // Pop up message
        svl.ui.popUpMessage = {};
        svl.ui.popUpMessage.holder = $("#pop-up-message-holder");
        svl.ui.popUpMessage.foreground = $("#pop-up-message-foreground");
        svl.ui.popUpMessage.background = $("#pop-up-message-background");
        svl.ui.popUpMessage.title = $("#pop-up-message-title");
        svl.ui.popUpMessage.content = $("#pop-up-message-content");
        svl.ui.popUpMessage.buttonHolder = $("#pop-up-message-button-holder")

        // Progress
        svl.ui.progress = {};
        svl.ui.progress.auditedDistance = $("#status-audited-distance");

        // ProgressPov
        svl.ui.progressPov = {};
        svl.ui.progressPov.holder = $("#progress-pov-holder");
        svl.ui.progressPov.rate = $("#progress-pov-current-completion-rate");
        svl.ui.progressPov.bar = $("#progress-pov-current-completion-bar");
        svl.ui.progressPov.filler = $("#progress-pov-current-completion-bar-filler");

        // Ribbon menu DOMs
        svl.ui.ribbonMenu = {};
        svl.ui.ribbonMenu.holder = $("#ribbon-menu-landmark-button-holder");
        svl.ui.ribbonMenu.streetViewHolder = $("#street-view-holder");
        svl.ui.ribbonMenu.buttons = $('span.modeSwitch');
        svl.ui.ribbonMenu.bottonBottomBorders = $(".ribbon-menu-mode-switch-horizontal-line");
        svl.ui.ribbonMenu.connector = $("#ribbon-street-view-connector");
        svl.ui.ribbonMenu.subcategoryHolder = $("#ribbon-menu-other-subcategory-holder");
        svl.ui.ribbonMenu.subcategories = $(".ribbon-menu-other-subcategories");
        svl.ui.ribbonMenu.informationButtons = $(".ribbon-mode-switch-info-buttons");

        // Context menu
        svl.ui.contextMenu = {};
        svl.ui.contextMenu.holder = $("#context-menu-holder");
        svl.ui.contextMenu.connector = $("#context-menu-vertical-connector");
        svl.ui.contextMenu.radioButtons = $("input[name='problem-severity']");
        svl.ui.contextMenu.temporaryProblemCheckbox = $("#context-menu-temporary-problem-checkbox");
        svl.ui.contextMenu.textBox = $("#context-menu-problem-description-text-box");
        svl.ui.contextMenu.closeButton = $("#context-menu-close-button");

        // Modal
        svl.ui.modalSkip = {};
        svl.ui.modalSkip.holder = $("#modal-skip-holder");
        svl.ui.modalSkip.ok = $("#modal-skip-ok-button");
        svl.ui.modalSkip.cancel = $("#modal-skip-cancel-button");
        svl.ui.modalSkip.radioButtons = $(".modal-skip-radio-buttons");
        svl.ui.modalComment = {};
        svl.ui.modalComment.holder = $("#modal-comment-holder");
        svl.ui.modalComment.ok = $("#modal-comment-ok-button");
        svl.ui.modalComment.cancel = $("#modal-comment-cancel-button");
        svl.ui.modalComment.textarea = $("#modal-comment-textarea");

        svl.ui.modalExample = {};
        svl.ui.modalExample.background = $(".modal-background");
        svl.ui.modalExample.close = $(".modal-example-close-buttons");
        svl.ui.modalExample.curbRamp = $("#modal-curb-ramp-example");
        svl.ui.modalExample.noCurbRamp = $("#modal-no-curb-ramp-example");
        svl.ui.modalExample.obstacle = $("#modal-obstacle-example");
        svl.ui.modalExample.surfaceProblem = $("#modal-surface-problem-example");

        svl.ui.modalMission = {};
        svl.ui.modalMission.holder = $("#modal-mission-holder");
        svl.ui.modalMission.foreground = $("#modal-mission-foreground");
        svl.ui.modalMission.background = $("#modal-mission-background");
        svl.ui.modalMission.missionTitle = $("#modal-mission-header");
        svl.ui.modalMission.instruction = $("#modal-mission-instruction");
        svl.ui.modalMission.closeButton = $("#modal-mission-close-button");


        // Modal Mission Complete
        svl.ui.modalMissionComplete = {};
        svl.ui.modalMissionComplete.holder = $("#modal-mission-complete-holder");
        svl.ui.modalMissionComplete.foreground = $("#modal-mission-complete-foreground");
        svl.ui.modalMissionComplete.background = $("#modal-mission-complete-background");
        svl.ui.modalMissionComplete.missionTitle = $("#modal-mission-complete-title");
        svl.ui.modalMissionComplete.message = $("#modal-mission-complete-message");
        svl.ui.modalMissionComplete.map = $("#modal-mission-complete-map");
        svl.ui.modalMissionComplete.closeButton = $("#modal-mission-complete-close-button");
        svl.ui.modalMissionComplete.totalAuditedDistance = $("#modal-mission-complete-total-audited-distance");
        svl.ui.modalMissionComplete.missionDistance = $("#modal-mission-complete-mission-distance");
        svl.ui.modalMissionComplete.remainingDistance = $("#modal-mission-complete-remaining-distance");
        svl.ui.modalMissionComplete.curbRampCount = $("#modal-mission-complete-curb-ramp-count");
        svl.ui.modalMissionComplete.noCurbRampCount = $("#modal-mission-complete-no-curb-ramp-count");
        svl.ui.modalMissionComplete.obstacleCount = $("#modal-mission-complete-obstacle-count");
        svl.ui.modalMissionComplete.surfaceProblemCount = $("#modal-mission-complete-surface-problem-count");
        svl.ui.modalMissionComplete.otherCount = $("#modal-mission-complete-other-count");

        // Zoom control
        svl.ui.zoomControl = {};
        svl.ui.zoomControl.holder = $("#zoom-control-holder");
        svl.ui.zoomControl.holder.append('<button id="zoom-in-button" class="button zoom-control-button"><img src="' + svl.rootDirectory + 'img/icons/ZoomIn.svg" class="zoom-button-icon" alt="Zoom in"><br /><u>Z</u>oom In</button>');
        svl.ui.zoomControl.holder.append('<button id="zoom-out-button" class="button zoom-control-button"><img src="' + svl.rootDirectory + 'img/icons/ZoomOut.svg" class="zoom-button-icon" alt="Zoom out"><br />Zoom Out</button>');
        svl.ui.zoomControl.zoomIn = $("#zoom-in-button");
        svl.ui.zoomControl.zoomOut = $("#zoom-out-button");

        // Form
        svl.ui.form = {};
        svl.ui.form.holder = $("#form-holder");
        svl.ui.form.commentField = $("#comment-field");
        svl.ui.form.skipButton = $("#skip-button");
        svl.ui.form.submitButton = $("#submit-button");

        svl.ui.leftColumn = {};
        svl.ui.leftColumn.sound = $("#left-column-sound-button");
        svl.ui.leftColumn.muteIcon = $("#left-column-mute-icon");
        svl.ui.leftColumn.soundIcon = $("#left-column-sound-icon");
        svl.ui.leftColumn.jump = $("#left-column-jump-button");
        svl.ui.leftColumn.feedback = $("#left-column-feedback-button");

        // Navigation compass
        svl.ui.compass = {};
        svl.ui.compass.messageHolder = $("#compass-message-holder");
        svl.ui.compass.message = $("#compass-message");

        // Canvas for the labeling area
        svl.ui.canvas = {};
        svl.ui.canvas.drawingLayer = $("#labelDrawingLayer");
        svl.ui.canvas.deleteIconHolder = $("#delete-icon-holder");
        svl.ui.canvas.deleteIcon = $("#LabelDeleteIcon");

        // Interaction viewer
        svl.ui.tracker = {};
        svl.ui.tracker.itemHolder = $("#tracked-items-holder");

        svl.ui.task = {};
        svl.ui.task.taskCompletionMessage = $("#task-completion-message-holder");

        svl.ui.onboarding = {};
        svl.ui.onboarding.holder = $("#onboarding-holder");
        svl.ui.onboarding.messageHolder = $("#onboarding-message-holder");
        svl.ui.onboarding.background = $("#onboarding-background");
        svl.ui.onboarding.foreground = $("#onboarding-foreground");
        svl.ui.onboarding.canvas = $("#onboarding-canvas");
        svl.ui.onboarding.handGestureHolder = $("#hand-gesture-holder");
    }

    function _init (params) {
        params = params || {};
        var panoId = params.panoId;
        var SVLat = parseFloat(params.initLat), SVLng = parseFloat(params.initLng);

        // Instantiate objects
        if (!("storage" in svl)) svl.storage = new Storage(JSON);
        svl.labelContainer = LabelContainer();
        svl.keyboard = Keyboard($);
        svl.canvas = Canvas($);
        svl.form = Form($, params.form);
        svl.overlayMessageBox = OverlayMessageBox();
        svl.statusField = StatusField();
        svl.missionStatus = MissionStatus();
        svl.neighborhoodStatus = NeighborhoodStatus();

        svl.labelCounter = LabelCounter(d3);
        svl.actionStack = ActionStack();
        svl.ribbon = RibbonMenu($);  // svl.ribbon.stopBlinking()
        svl.popUpMessage = PopUpMessage($);
        svl.zoomControl = ZoomControl($);
        svl.missionProgress = MissionProgress($);
        svl.pointCloud = PointCloud({ panoIds: [panoId] });
        svl.tracker = Tracker();
        svl.tracker.push('TaskStart');
        // svl.trackerViewer = TrackerViewer();
        svl.labelFactory = LabelFactory();
        svl.compass = Compass(d3, turf);
        svl.contextMenu = ContextMenu($);
        svl.audioEffect = AudioEffect();

        svl.modalSkip = ModalSkip($);
        svl.modalComment = ModalComment($);
        svl.modalMission = ModalMission($, L);
        svl.modalMissionComplete = ModalMissionComplete($, d3, L);
        svl.modalExample = ModalExample();
        svl.modalMissionComplete.hide();

        svl.panoramaContainer = PanoramaContainer(google);

        var neighborhood;
        svl.neighborhoodFactory = NeighborhoodFactory();
        svl.neighborhoodContainer = NeighborhoodContainer();
        if ('regionId' in params) {
            neighborhood = svl.neighborhoodFactory.create(params.regionId, params.regionLayer);
            svl.neighborhoodContainer.add(neighborhood);
            svl.neighborhoodContainer.setCurrentNeighborhood(neighborhood);
        } else {
            var regionId = 0;
            neighborhood = svl.neighborhoodFactory.create(regionId);
            svl.neighborhoodContainer.add(neighborhood);
            svl.neighborhoodContainer.setCurrentNeighborhood(neighborhood);
        }

        if (!("taskFactory" in svl && svl.taskFactory)) svl.taskFactory = TaskFactory(turf);
        if (!("taskContainer" in svl && svl.taskContainer)) svl.taskContainer = TaskContainer(turf);

        // Initialize things that needs data loading.
        var loadingAnOboardingTaskCompleted = false,
            loadingTasksCompleted = false,
            loadingMissionsCompleted = false;

        // This is a callback function that is executed after every loading process is done.
        function handleDataLoadComplete () {
            if (loadingAnOboardingTaskCompleted && loadingTasksCompleted && loadingMissionsCompleted) {
                // Check if the user has completed the onboarding tutorial.
                // If not, let them work on the the tutorial.
                var completedMissions = svl.missionContainer.getCompletedMissions(),
                    missionLabels = completedMissions.map(function (m) { return m.label; }),
                    neighborhood = svl.neighborhoodContainer.getStatus("currentNeighborhood"),
                    mission;

                // Set the current mission
                if (missionLabels.indexOf("onboarding") < 0 && !svl.storage.get("completedOnboarding")) {
                    // Set the current mission to onboarding
                    svl.onboarding = Onboarding($);
                    mission = svl.missionContainer.getMission("noRegionId", "onboarding", 1);
                    if (!mission) {
                        // If the onboarding mission is not yet in the missionContainer, add it there.
                        mission = svl.missionFactory.createOnboardingMission(1, false);
                        svl.missionContainer.add(null, mission);
                    }
                    svl.missionContainer.setCurrentMission(mission);
                } else {
                    // Set the current mission to either the initial-mission or something else.
                    mission = svl.missionContainer.getMission("noRegionId", "initial-mission");
                    if (mission.isCompleted()) {
                        var missions = svl.missionContainer.getMissionsByRegionId(neighborhood.getProperty("regionId"));
                        missions = missions.filter(function (m) { return !m.isCompleted(); });
                        mission = missions[0];  // Todo. Take care of the case where length of the missions is 0
                    }
                    svl.missionContainer.setCurrentMission(mission);

                    // Compute the route for the current mission
                    var currentTask = svl.taskContainer.getCurrentTask();
                    var route = mission.computeRoute(currentTask);
                    mission.setRoute(route);
                }

                // Check if this an anonymous user or not.
                // If not, record that that this user has completed the onboarding.
                if ('user' in svl && svl.user.getProperty('username') != "anonymous" &&
                    missionLabels.indexOf("onboarding") < 0 && svl.storage.get("completedOnboarding")) {
                    var onboardingMission = svl.missionContainer.getMission(null, "onboarding");
                    onboardingMission.setProperty("isCompleted", true);
                    svl.missionContainer.addToCompletedMissions(onboardingMission);
                    svl.missionContainer.stage(onboardingMission).commit();
                }

                // Popup the message explaining the goal of the current mission if the current mission is not onboarding
                if (mission.getProperty("label") != "onboarding") {
                    svl.modalMission.setMission(mission);
                }

                if ("missionProgress" in svl) {
                    svl.missionProgress.update();
                }
            }
        }

        // Fetch an onboarding task.
        svl.taskContainer.fetchATask("onboarding", 15250, function () {
            loadingAnOboardingTaskCompleted = true;
            handleDataLoadComplete();
        });

        // Fetch tasks in the onboarding region.
        svl.taskContainer.fetchTasksInARegion(neighborhood.getProperty("regionId"), function () {
            loadingTasksCompleted = true;
            handleDataLoadComplete();
        });

        svl.missionContainer = MissionContainer ($, {
            callback: function () {
                loadingMissionsCompleted = true;
                handleDataLoadComplete();
            }
        });
        svl.missionFactory = MissionFactory ();

        svl.form.disableSubmit();
        svl.form.setTaskRemaining(1);
        svl.form.setTaskDescription('TestTask');
        svl.form.setTaskPanoramaId(panoId);
        
        // Set map parameters and instantiate it.
        var mapParam = {};
        mapParam.canvas = svl.canvas;
        mapParam.overlayMessageBox = svl.overlayMessageBox;
        mapParam.Lat = SVLat;
        mapParam.Lng = SVLng;
        mapParam.panoramaPov = { heading: 0, pitch: -10, zoom: 1 };
        mapParam.taskPanoId = panoId;
        mapParam.availablePanoIds = [mapParam.taskPanoId];

        if (getStatus("isFirstTask")) {
            svl.popUpMessage.setPosition(10, 120, width=400, height=undefined, background=true);
            svl.popUpMessage.setMessage("<span class='bold'>Remember, label all the landmarks close to the bus stop.</span> " +
                "Now the actual task begins. Click OK to start the task.");
            svl.popUpMessage.appendOKButton();
            svl.popUpMessage.show();
        } else {
            svl.popUpMessage.hide();
        }

        svl.map = Map($, google, turf, mapParam);
        svl.map.disableClickZoom();

        var task;
        if ("taskContainer" in svl) {
            task = svl.taskContainer.getCurrentTask();
        }
        if (task && typeof google != "undefined") {
          google.maps.event.addDomListener(window, 'load', task.render);
        }
    }

    function getStatus (key) { 
        return key in status ? status[key] : null; 
    }
    function setStatus (key, value) { 
        status[key] = value; return this; 
    }

    _initUI();
    _init(params);

    self.getStatus = getStatus;
    self.setStatus = setStatus;
    return self;
}

/**
 * The Map module. This module is responsible for the interaction with Street View and Google Maps.
 * Todo. Need to clean this module up...
 * @param $ {object} jQuery object
 * @param google {object} Google Maps object
 * @param turf {object} turf object
 * @param params {object} parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Map ($, google, turf, params) {
    var self = { className: 'Map' },
        canvas,
        overlayMessageBox,
        mapIconInterval,
        lock = {
            renderLabels : false
        },
        markers = [],
        properties = {
            browser : 'unknown',
            latlng : {
                lat : undefined,
                lng : undefined
            },
            initialPanoId : undefined,
            panoramaPov : {
                heading : 359,
                pitch : -10,
                zoom : 1
            },
            map: null,
            maxPitch: 0,
            minPitch: -35,
            minHeading: undefined,
            maxHeading: undefined,
            mode : 'Labeling',
            isInternetExplore: undefined
        },
        status = {
            availablePanoIds : undefined,
            currentPanoId: undefined,
            disablePanning: false,
            disableWalking : false,
            disableClickZoom: false,
            hideNonavailablePanoLinks : false,
            lockDisablePanning: false,
            lockDisableWalking : false,
            panoLinkListenerSet: false,
            svLinkArrowsLoaded : false
        };

    var initialPositionUpdate = true,
        panoramaOptions,
        STREETVIEW_MAX_DISTANCE = 50,
        googleMapsPaneBlinkInterval;
    svl.streetViewService = typeof google != "undefined" ? new google.maps.StreetViewService() : null;

    // Mouse status and mouse event callback functions
    var mouseStatus = {
            currX:0,
            currY:0,
            prevX:0,
            prevY:0,
            leftDownX:0,
            leftDownY:0,
            leftUpX:0,
            leftUpY:0,
            isLeftDown:false
        };

    // Maps variables
    var fenway, map, mapOptions, mapStyleOptions;

    // Street View variables
    var _streetViewInit;

    // Map UI setting
    // http://www.w3schools.com/googleAPI/google_maps_controls.asp
    if (params.panoramaPov) {
        properties.panoramaPov = params.panoramaPov;
    } else {
        properties.panoramaPov = {
            heading: 0,
            pitch: 0,
            zoom: 1
        };
    }
    if (params.latlng) {
        properties.latlng = params.latlng;
    } else if (('Lat' in params) && ('Lng' in params)) {
        properties.latlng = {'lat': params.Lat, 'lng': params.Lng};
    } else {
        throw self.className + ': latlng not defined.';
    }

    // fenway = new google.maps.LatLng(params.targetLat, params.targetLng);
    fenway = typeof google != "undefined" ? new google.maps.LatLng(properties.latlng.lat, properties.latlng.lng) : null;

    mapOptions = {
        center: fenway,
        mapTypeControl:false,
        mapTypeId: typeof google != "undefined" ? google.maps.MapTypeId.ROADMAP : null,
        maxZoom : 20,
        minZoom : 14,
        overviewMapControl:false,
        panControl:false,
        rotateControl:false,
        scaleControl:false,
        streetViewControl:true,
        zoomControl:false,
        zoom: 18
    };

    var mapCanvas = document.getElementById("google-maps");
    map = typeof google != "undefined" ? new google.maps.Map(mapCanvas, mapOptions) : null;

    // Styling google map.
    // http://stackoverflow.com/questions/8406636/how-to-remove-all-from-google-map
    // http://gmaps-samples-v3.googlecode.com/svn/trunk/styledmaps/wizard/index.html
    mapStyleOptions = [
        {
            featureType: "all",
            stylers: [
                { visibility: "off" }
            ]
        },
        {
            featureType: "road",
            stylers: [
                { visibility: "on" }
            ]
        },
        {
            "elementType": "labels",
            "stylers": [
                { "visibility": "off" }
            ]
        }
    ];

    if (map) map.setOptions({styles: mapStyleOptions});

    function _init(params) {
        params = params || {};

        self.properties = properties; // Make properties public.
        properties.browser = svl.util.getBrowser();

        if ("overlayMessageBox" in params) { overlayMessageBox = params.overlayMessageBox; }

        // Set GSV panorama options
        // To not show StreetView controls, take a look at the following gpage
        // http://blog.mridey.com/2010/05/controls-in-maps-javascript-api-v3.html
        // Set 'mode' to 'html4' in the SV panoramaOption.
        // https://groups.google.com/forum/?fromgroups=#!topic/google-maps-js-api-v3/q-SjeW19TJw
        if (params.taskPanoId) {
            panoramaOptions = {
                mode : 'html4',
                // position: fenway,
                pov: properties.panoramaPov,
                pano: params.taskPanoId
            };
        } else if (params.Lat && params.Lng) {
            fenway = new google.maps.LatLng(params.Lat, params.Lng);
            panoramaOptions = {
                mode : 'html4',
                position: fenway,
                pov: properties.panoramaPov
            };

        } else {
            console.warn(self.className + ' init(): The pano id nor panorama position is given. Cannot initialize the panorama.');
        }

        var panoCanvas = document.getElementById('pano');
        svl.panorama = typeof google != "undefined" ? new google.maps.StreetViewPanorama(panoCanvas, panoramaOptions) : null;
        if (svl.panorama) {
            svl.panorama.set('addressControl', false);
            svl.panorama.set('clickToGo', false);
            svl.panorama.set('disableDefaultUI', true);
            svl.panorama.set('linksControl', true);
            svl.panorama.set('navigationControl', false);
            svl.panorama.set('panControl', false);
            svl.panorama.set('zoomControl', false);
            svl.panorama.set('keyboardShortcuts', true);
        }


        properties.initialPanoId = params.taskPanoId;

        // Set so the links to panoaramas that are not listed on availablePanoIds will be removed
        status.availablePanoIds = params.availablePanoIds;

        // Attach listeners to dom elements
        svl.ui.map.viewControlLayer.bind('mousedown', handlerViewControlLayerMouseDown);
        svl.ui.map.viewControlLayer.bind('mouseup', handlerViewControlLayerMouseUp);
        svl.ui.map.viewControlLayer.bind('mousemove', handlerViewControlLayerMouseMove);
        svl.ui.map.viewControlLayer.bind('mouseleave', handlerViewControlLayerMouseLeave);

        svl.ui.map.viewControlLayer[0].onselectstart = function () { return false; };


        // Add listeners to the SV panorama
        // https://developers.google.com/maps/documentation/javascript/streetview#StreetViewEvents
        if (typeof google != "undefined") {
            google.maps.event.addListener(svl.panorama, "pov_changed", handlerPovChange);
            google.maps.event.addListener(svl.panorama, "position_changed", handlerPositionUpdate);
            google.maps.event.addListener(svl.panorama, "pano_changed", handlerPanoramaChange);
            google.maps.event.addListenerOnce(svl.panorama, "pano_changed", modeSwitchWalkClick);
        }

        // Connect the map view and panorama view
        if (map && svl.panorama) map.setStreetView(svl.panorama);

        // Set it to walking mode initially.

        _streetViewInit = setInterval(initStreetView, 100);

        // Hide the dude on the top-left of the map.
        mapIconInterval = setInterval(_removeIcon, 0.2);

        // For Internet Explore, append an extra canvas in viewControlLayer.
        properties.isInternetExplore = $.browser['msie'];
        if (properties.isInternetExplore) {
            svl.ui.map.viewControlLayer.append('<canvas width="720px" height="480px"  class="Window_StreetView" style=""></canvas>');
        }
    }

    /**
     * Remove icons on Google Maps
     */
    function _removeIcon() {
        var doms = $('.gmnoprint'), $images;
        if (doms.length > 0) {
            window.clearInterval(mapIconInterval);
            $.each($('.gmnoprint'), function (i, v) {
                $images = $(v).find('img');
                if ($images) $images.css('visibility', 'hidden');
            });
        }
    }

    /**
     * Blink google maps pane
     */
    function blinkGoogleMaps () {
        var highlighted = false;
        stopBlinkingGoogleMaps();
        googleMapsPaneBlinkInterval = window.setInterval(function () {
            svl.ui.googleMaps.overlay.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * This function maps canvas coordinate to image coordinate
     * @param canvasX
     * @param canvasY
     * @param pov
     * @returns {{x: number, y: number}}
     */
    function canvasCoordinateToImageCoordinate (canvasX, canvasY, pov) {
        // return svl.misc.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov);
        var zoomFactor = svl.zoomFactor[pov.zoom];
        var x = svl.svImageWidth * pov.heading / 360 + (svl.alpha_x * (canvasX - (svl.canvasWidth / 2)) / zoomFactor);
        var y = (svl.svImageHeight / 2) * pov.pitch / 90 + (svl.alpha_y * (canvasY - (svl.canvasHeight / 2)) / zoomFactor);
        return { x: x, y: y };
    }

    /**
     * This method disables zooming by double click.
     */
    function disableClickZoom () {
        status.disableClickZoom = true;
    }

    /**
     * Disable panning on Street View
     * @returns {disablePanning}
     */
    function disablePanning () {
        if (!status.lockDisablePanning) {
            status.disablePanning = true;
        }
        return this;
    }

    /**
     * This method disables walking by hiding links towards other Street View panoramas.
     * @returns {disableWalking}
     */
    function disableWalking () {
        if (!status.lockDisableWalking) {
            // Disable clicking links and changing POV
            hideLinks();
            svl.ui.map.modeSwitchWalk.css('opacity', 0.5);
            status.disableWalking = true;
        }
        return this;
    }

    /**
     * This method enables zooming by double click.
     */
    function enableClickZoom () {
        status.disableClickZoom = false;
    }

    /**
     * Enable panning on Street View
     * @returns {enablePanning}
     */
    function enablePanning () {
        if (!status.lockDisablePanning) {
            status.disablePanning = false;
        }
        return this;
    }

    /**
     * This method enables walking to other panoramas by showing links.
     */
    function enableWalking () {
        // This method shows links on SV and enables users to walk.
        if (!status.lockDisableWalking) {
            // Enable clicking links and changing POV
            showLinks();
            svl.ui.map.modeSwitchWalk.css('opacity', 1);
            status.disableWalking = false;
        }
        return this;
    }

    /**
     * Get the initial panorama id.
     * @returns {undefined|*}
     */
    function getInitialPanoId () {
        return properties.initialPanoId;
    }

    /**
     * Get the google map
     * @returns {null}
     */
    function getMap() {
        return map;
    }

    /**
     * Get the max pitch
     * @returns {number}
     */
    function getMaxPitch () {
        return properties.maxPitch;
    }

    /**
     * Get the minimum pitch
     * @returns {number|*}
     */
    function getMinPitch () {
        return properties.minPitch;
    }

    /**
     * Returns a panorama dom element that is dynamically created by GSV API
     * @returns {*}
     */
    function getPanoramaLayer () {
        return svl.ui.map.pano.children(':first').children(':first').children(':first').children(':eq(5)');
    }

    /**
     * Get the current panorama id.
     * @returns {string} Google Street View panorama id
     */
    function getPanoId () {
        return svl.panorama.getPano();
    }

    /**
     * Get the current latlng coordinate
     * @returns {{lat: number, lng: number}}
     */
    function getPosition () {
        var pos = svl.panorama.getPosition();
        return { 'lat' : pos.lat(), 'lng' : pos.lng() };
    }

    /**
     * Get the current point of view
     * @returns {object} pov
     */
    function getPov () {
        var pov = svl.panorama.getPov();

        // Pov can be less than 0. So adjust it.
        while (pov.heading < 0) {
            pov.heading += 360;
        }

        // Pov can be more than 360. Adjust it.
        while (pov.heading > 360) {
            pov.heading -= 360;
        }
        return pov;
    }

    /**
     * This method returns a value of a specified property.
     * @param prop
     * @returns {*}
     */
    function getProperty (prop) {
        return (prop in properties) ? properties[prop] : false;
    }

    /**
     * Get svg element (arrows) in Street View.
     * @returns {*}
     */
    function getLinkLayer () {
        return svl.ui.map.pano.find('svg').parent();
    }

    /**
     * Callback for pano_changed event (https://developers.google.com/maps/documentation/javascript/streetview).
     * Update the map pane, and also query data for the new panorama.
     */
    function handlerPanoramaChange () {
        if (svl.panorama) {
            var panoramaPosition = svl.panorama.getPosition();
            map.setCenter(panoramaPosition);

            if (svl.canvas) {
                svl.canvas.clear();
                svl.canvas.setVisibilityBasedOnLocation('visible', getPanoId());
                svl.canvas.render2();
            }

            // Attach listeners to svl.pointCloud
            if ('pointCloud' in svl && svl.pointCloud) {
                var panoId = getPanoId();
                var pointCloud = svl.pointCloud.getPointCloud(panoId);
                if (!pointCloud) {
                    svl.pointCloud.createPointCloud(getPanoId());
                    // svl.pointCloud.ready(panoId, function () {
                        // console.log(svl.pointCloud.getPointCloud(panoId));
                    //});
                }
            }
        } else {
            throw self.className + ' handlerPanoramaChange(): panorama not defined.';
        }

        if ('compass' in svl) { svl.compass.update(); }
    }

    /**
     * A callback for position_change.
     */
    function handlerPositionUpdate () {
        var position = svl.panorama.getPosition();

        if ("canvas" in svl && svl.canvas) updateCanvas();
        if ("compass" in svl) svl.compass.update();
        if ("missionProgress" in svl) svl.missionProgress.update();
        if ("taskContainer" in svl) {
            svl.taskContainer.update();

            // End of the task if the user is close enough to the end point
            var task = svl.taskContainer.getCurrentTask();
            if (task) {
                if (task.isAtEnd(position.lat(), position.lng(), 25)) {
                    svl.taskContainer.endTask(task);
                    var newTask = svl.taskContainer.nextTask(task);
                    svl.taskContainer.setCurrentTask(newTask);
                    
                    // Check if the interface jumped the user to another discontinuous location. If the user jumped,
                    // tell them that we moved her to another location in the same neighborhood.
                    if (!task.isConnectedTo(newTask) && !svl.taskContainer.isFirstTask()) {
                        svl.popUpMessage.notify("Jumped back to your neighborhood!",
                            "We sent you back into the neighborhood you have been walking around! Please continue to " +
                            "make this neighborhood more accessible for everyone!");
                    }

                    var geometry = newTask.getGeometry();
                    if (geometry) {
                        var lat = geometry.coordinates[0][1],
                            lng = geometry.coordinates[0][0],
                            currentLatLng = getPosition(),
                            newTaskPosition = turf.point([lng, lat]),
                            currentPosition = turf.point([currentLatLng.lng, currentLatLng.lat]),
                            distance = turf.distance(newTaskPosition, currentPosition, "kilometers");

                        // Jump to the new location if it's really far away.
                        if (distance > 0.1) setPosition(lat, lng);
                    }
                }
            }
        }

        // Set the heading angle when the user is dropped to the new position
        if (initialPositionUpdate && 'compass' in svl) {
            var pov = svl.panorama.getPov(),
                compassAngle = svl.compass.getCompassAngle();
            pov.heading = parseInt(pov.heading - compassAngle, 10) % 360;
            svl.panorama.setPov(pov);
            initialPositionUpdate = false;
        }
    }

    /**
     * Callback for pov update
     */
    function handlerPovChange () {
        // This is a callback function that is fired when pov is changed
        if ("canvas" in svl && svl.canvas) { updateCanvas(); }
        if ("compass" in svl) { svl.compass.update(); }
    }

    /**
     * This is a callback function that is fired with the mouse down event
     * on the view control layer (where you control street view angle.)
     * @param e
     */
    function handlerViewControlLayerMouseDown (e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = mouseposition(e, this).x;
        mouseStatus.leftDownY = mouseposition(e, this).y;
        svl.tracker.push('ViewControl_MouseDown', {x: mouseStatus.leftDownX, y:mouseStatus.leftDownY});

        // if (!status.disableWalking) {
            // Setting a cursor
            // http://www.jaycodesign.co.nz/css/cross-browser-css-grab-cursors-for-dragging/
            if (svl.keyboard.isShiftDown()) {
                setViewControlLayerCursor('ZoomOut');
            } else {
                setViewControlLayerCursor('ClosedHand');
            }
        // }

        // Adding delegation on SVG elements
        // http://stackoverflow.com/questions/14431361/event-delegation-on-svg-elements
        // Or rather just attach a listener to svg and check it's target.
        if (!status.panoLinkListenerSet) {
            try {
                $('svg')[0].addEventListener('click', function (e) {
                    var targetPanoId = e.target.getAttribute('pano');
                    if (targetPanoId) {
                        svl.tracker.push('WalkTowards', {'TargetPanoId': targetPanoId});
                    }
                });
                status.panoLinkListenerSet = true;
            } catch (err) {

            }
        }

    }

    /**
     * This is a callback function that is called with mouse up event on
     * the view control layer (where you change the Google Street view angle.
     * @param e
     */
    function handlerViewControlLayerMouseUp (e) {
        var currTime;

        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = mouseposition(e, this).x;
        mouseStatus.leftUpY = mouseposition(e, this).y;
        svl.tracker.push('ViewControl_MouseUp', {x:mouseStatus.leftUpX, y:mouseStatus.leftUpY});

        // if (!status.disableWalking) {
            // Setting a mouse cursor
            // http://www.jaycodesign.co.nz/css/cross-browser-css-grab-cursors-for-dragging/
            if (!svl.keyboard.isShiftDown()) {
                setViewControlLayerCursor('OpenHand');
                // svl.ui.map.viewControlLayer.css("cursor", "url(public/img/cursors/openhand.cur) 4 4, move");
            } else {
                setViewControlLayerCursor('ZoomOut');
            }
        // }

        currTime = new Date().getTime();

        if ('canvas' in svl && svl.canvas) {
            var point = svl.canvas.isOn(mouseStatus.currX, mouseStatus.currY);
            if (point && point.className === "Point") {
                var path = point.belongsTo(),
                    selectedLabel = path.belongsTo(),
                    canvasCoordinate = point.getCanvasCoordinate(getPov());

                svl.canvas.setCurrentLabel(selectedLabel);
                if ('contextMenu' in svl) {
                    svl.contextMenu.show(canvasCoordinate.x, canvasCoordinate.y, {
                        targetLabel: selectedLabel,
                        targetLabelColor: selectedLabel.getProperty("labelFillStyle")
                    });
                }
            } else if (currTime - mouseStatus.prevMouseUpTime < 300) {
                // Double click
                svl.tracker.push('ViewControl_DoubleClick');
                if (!status.disableClickZoom) {

                    if (svl.keyboard.isShiftDown()) {
                        // If Shift is down, then zoom out with double click.
                        svl.zoomControl.zoomOut();
                        svl.tracker.push('ViewControl_ZoomOut');
                    } else {
                        // If Shift is up, then zoom in wiht double click.
                        svl.zoomControl.pointZoomIn(mouseStatus.leftUpX, mouseStatus.leftUpY);
                        svl.tracker.push('ViewControl_ZoomIn');
                    }
                } else {
                    // Double click to walk. First check whether Street View is available at the point where user has
                    // double clicked. If a Street View scene exists and the distance is below STREETVIEW_MAX_DISTANCE (25 meters),
                    // then jump to the scene
                    if (!status.disableWalking) {
                        var imageCoordinate = canvasCoordinateToImageCoordinate (mouseStatus.currX, mouseStatus.currY, getPov()),
                            latlng = getPosition(),
                            newLatlng = imageCoordinateToLatLng(imageCoordinate.x, imageCoordinate.y, latlng.lat, latlng.lng);
                        if (newLatlng) {
                            var distance = svl.util.math.haversine(latlng.lat, latlng.lng, newLatlng.lat, newLatlng.lng);
                            if (distance < STREETVIEW_MAX_DISTANCE) {
                                svl.streetViewService.getPanoramaByLocation(new google.maps.LatLng(newLatlng.lat, newLatlng.lng), STREETVIEW_MAX_DISTANCE, function (streetViewPanoramaData, status) {
                                    if (status === google.maps.StreetViewStatus.OK) svl.panorama.setPano(streetViewPanoramaData.location.pano);
                                });
                            }
                        }
                    }
                }
            }
        }
        mouseStatus.prevMouseUpTime = currTime;
    }

    /**
     *
     * @param e
     */
    function handlerViewControlLayerMouseLeave (e) {
        mouseStatus.isLeftDown = false;
    }

    /**
     * This is a callback function that is fired when a user moves a mouse on the
     * view control layer where you change the pov.
     */
    function handlerViewControlLayerMouseMove (e) {
        mouseStatus.currX = mouseposition(e, this).x;
        mouseStatus.currY = mouseposition(e, this).y;

        // Show a link and fade it out
        if (!status.disableWalking) {
            showLinks(2000);
        } else {
            hideLinks();
        }

        if (mouseStatus.isLeftDown) {
            setViewControlLayerCursor('ClosedHand');
        } else {
            if (!svl.keyboard.isShiftDown()) {
                setViewControlLayerCursor('OpenHand');
                // svl.ui.map.viewControlLayer.css("cursor", "url(public/img/cursors/openhand.cur) 4 4, move");
            } else {
                setViewControlLayerCursor('ZoomOut');
            }
        }

        if (mouseStatus.isLeftDown && status.disablePanning === false) {
            // If a mouse is being dragged on the control layer, move the sv image.
            var dx = mouseStatus.currX - mouseStatus.prevX;
            var dy = mouseStatus.currY - mouseStatus.prevY;
            var pov = getPov();
            var zoom = pov.zoom;
            var zoomLevel = svl.zoomFactor[zoom];

            dx = dx / (2 * zoomLevel);
            dy = dy / (2 * zoomLevel);
            dx *= 1.5;
            dy *= 1.5;
            updatePov(dx, dy);
        }

        // Show label delete menu
        if ('canvas' in svl && svl.canvas) {
            var item = svl.canvas.isOn(mouseStatus.currX,  mouseStatus.currY);
            if (item && item.className === "Point") {
                var path = item.belongsTo();
                var selectedLabel = path.belongsTo();

                svl.canvas.setCurrentLabel(selectedLabel);
                svl.canvas.showLabelTag(selectedLabel);
                svl.canvas.clear();
                svl.canvas.render2();
            } else if (item && item.className === "Label") {
                var selectedLabel = item;
                svl.canvas.setCurrentLabel(selectedLabel);
                svl.canvas.showLabelTag(selectedLabel);
            } else if (item && item.className === "Path") {
                var label = item.belongsTo();
                svl.canvas.clear();
                svl.canvas.render2();
                svl.canvas.showLabelTag(label);
            }
            else {
                // canvas.hideDeleteLabel();
                svl.canvas.showLabelTag(undefined);
                svl.canvas.setCurrentLabel(undefined);
            }
        }

        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }


    /**
     * This method hides links to neighboring Street View images by changing the
     * svg path elements.
     *
     * @returns {hideLinks} This object.
     */
    function hideLinks () {
        if (properties.browser === 'chrome') {
            // Somehow chrome does not allow me to select path
            // and fadeOut. Instead, I'm just manipulating path's style
            // and making it hidden.
            $('path').css('visibility', 'hidden');
        } else {
            // $('path').fadeOut(1000);
            $('path').css('visibility', 'hidden');
        }
        return this;
    }

    /**
     * This method takes an image coordinate and map it to the corresponding latlng position
     * @param imageX image x coordinate
     * @param imageY image y coordinate
     * @param lat current latitude of where you are standing
     * @param lng current longitude of where you are standing
     * @returns {*}
     */
    function imageCoordinateToLatLng(imageX, imageY, lat, lng) {
        var pc = svl.pointCloud.getPointCloud(getPanoId());
        if (pc) {
            var p = svl.util.scaleImageCoordinate(imageX, imageY, 1 / 26),
                idx = 3 * (Math.ceil(p.x) + 512 * Math.ceil(p.y)),
                dx = pc.pointCloud[idx],
                dy = pc.pointCloud[idx + 1],
                delta = svl.util.math.latlngOffset(lat, dx, dy);
            return { lat: lat + delta.dlat, lng: lng + delta.dlng };
        } else {
            return null;
        }
    }



    /**
     * Initailize Street View
     */
    function initStreetView () {
        // Initialize the Street View interface
        var numPath = svl.ui.map.viewControlLayer.find("path").length;
        if (numPath !== 0) {
            status.svLinkArrowsLoaded = true;
            window.clearTimeout(_streetViewInit);
        }
    }


    /**
     * Load the state of the map
     */
    function load () {
        return svl.storage.get("map");
    }

    /**
     * Lock disable panning
     * @returns {lockDisablePanning}
     */
    function lockDisablePanning () {
        status.lockDisablePanning = true;
        return this;
    }

    /**
     * This method locks status.disableWalking
     * @returns {lockDisableWalking}
     */
    function lockDisableWalking () {
        status.lockDisableWalking = true;
        return this;
    }

    /** Lock render labreling */
    function lockRenderLabels () {
        lock.renderLabels = true;
        return this;
    }

    /**
     * This method brings the links (<, >) to the view control layer so that a user can click them to walk around
     */
    function makeLinksClickable () {
        // Bring the layer with arrows forward.
        var $links = getLinkLayer();
        svl.ui.map.viewControlLayer.append($links);

        if (properties.browser === 'mozilla') {
            // A bug in Firefox? The canvas in the div element with the largest z-index.
            svl.ui.map.viewControlLayer.append(svl.ui.map.canvas);
        } else if (properties.browser === 'msie') {
            svl.ui.map.viewControlLayer.insertBefore(svl.ui.map.drawingLayer);
        }
    }

    /**
     *
     */
    function modeSwitchLabelClick () {
        svl.ui.map.drawingLayer.css('z-index','1');
        svl.ui.map.viewControlLayer.css('z-index', '0');
        // svl.ui.map.streetViewHolder.append(svl.ui.map.drawingLayer);

        if (properties.browser === 'mozilla') { svl.ui.map.drawingLayer.append(svl.ui.map.canvas); }
        hideLinks();
    }

    /**
     * This function brings a div element for drawing labels in front of
     */
    function modeSwitchWalkClick () {
        svl.ui.map.viewControlLayer.css('z-index', '1');
        svl.ui.map.drawingLayer.css('z-index','0');
        if (!status.disableWalking) {
            // Show the link arrows on top of the panorama and make links clickable
            showLinks();
            makeLinksClickable();
        }
    }


    /**
     * Plot markers on the Google Maps pane
     *
     * Example: https://google-developers.appspot.com/maps/documentation/javascript/examples/icon-complex?hl=fr-FR
     * @returns {boolean}
     */
    function plotMarkers () {
        if (canvas) {
            var prop, labelType, latlng, labels = canvas.getLabels(), labelsLen = labels.length;

            // Clear the map first, then plot markers
            for (var i = 0; i < markers.length; i++) { markers[i].setMap(null); }

            markers = [];
            for (i = 0; i < labelsLen; i++) {
                prop = labels[i].getProperties();
                labelType = prop.labelProperties.labelType;
                latlng = prop.panoramaProperties.latlng;
                if (prop.labelerId.indexOf('Researcher') !== -1) {
                    // Skip researcher labels
                    continue;
                }

                markers.push(
                    new google.maps.Marker({
                        position: new google.maps.LatLng(latlng.lat, latlng.lng),
                        map: map,
                        zIndex: i
                    })
                );
            }
        }
    }

    /**
     * Save the state of the map
     */
    function save () {
        svl.storage.set("map", {"pov": getPov(), "latlng": getPosition(), "panoId": getPanoId() });
    }

    /**
     * Set map position
     * @param lat
     * @param lng
     */
    function setPosition (lat, lng) {
        var latlng = new google.maps.LatLng(lat, lng);
        svl.panorama.setPosition(latlng);
        map.setCenter(latlng);
        return this;
    }

    /**
     * Stop blinking google maps
     */
    function stopBlinkingGoogleMaps () {
        window.clearInterval(googleMapsPaneBlinkInterval);
        svl.ui.googleMaps.overlay.removeClass("highlight-50");
    }

    /**
     * Update the canvas
     */
    function updateCanvas () {
        svl.canvas.clear();
        if (status.currentPanoId !== getPanoId()) {
            svl.canvas.setVisibilityBasedOnLocation('visible', getPanoId());
        }
        status.currentPanoId = getPanoId();
        svl.canvas.render2();
    }

    /**
     *
     * @param type
     */
    function setViewControlLayerCursor(type) {
        switch(type) {
            case 'ZoomOut':
                svl.ui.map.viewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/Cursor_ZoomOut.png) 4 4, move");
                break;
            case 'OpenHand':
                svl.ui.map.viewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/openhand.cur) 4 4, move");
                break;
            case 'ClosedHand':
                svl.ui.map.viewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/closedhand.cur) 4 4, move");
                break;
            default:
                svl.ui.map.viewControlLayer.css("cursor", "default");
        }
    }

    /**
     * Show links (<, >) for walking
     * @param delay
     */
    function showLinks (delay) {
        // Show links

        // This is kind of redundant, but as long as the link arrows have not been
        // moved to user control layer, keep calling the modeSwitchWalkClick()
        // to bring arrows to the top layer. Once loaded, move svLinkArrowsLoaded to true.
        if (!status.svLinkArrowsLoaded) {
            var numPath = svl.ui.map.viewControlLayer.find("path").length;
            if (numPath === 0) {
                makeLinksClickable();
            } else {
                status.svLinkArrowsLoaded = true;
            }
        }

        if (status.hideNonavailablePanoLinks &&
            status.availablePanoIds) {
            $.each($('path'), function (i, v) {
                if ($(v).attr('pano')) {
                    var panoId = $(v).attr('pano');
                    var idx = status.availablePanoIds.indexOf(panoId);

                    if (idx === -1) {
                        $(v).prev().prev().remove();
                        $(v).prev().remove();
                        $(v).remove();
                    } else {
                        //if (properties.browser === 'chrome') {
                        // Somehow chrome does not allow me to select path
                        // and fadeOut. Instead, I'm just manipulating path's style
                        // and making it hidden.
                        $(v).prev().prev().css('visibility', 'visible');
                        $(v).prev().css('visibility', 'visible');
                        $(v).css('visibility', 'visible');
                    }
                }
            });
        } else {
            if (properties.browser === 'chrome') {
                // Somehow chrome does not allow me to select path
                // and fadeOut. Instead, I'm just manipulating path's style
                // and making it hidden.
                $('path').css('visibility', 'visible');
            } else {
                if (!delay) {
                    delay = 0;
                }
                // $('path').show();
                $('path').css('visibility', 'visible');
            }
        }
    }

    /**
     * Update POV of Street View as a user drag a mouse cursor.
     * @param dx
     * @param dy
     */
    function updatePov (dx, dy) {
        if (svl.panorama) {
            var pov = svl.panorama.getPov(),
                alpha = 0.25;

            pov.heading -= alpha * dx;
            pov.pitch += alpha * dy;

            //
            // View port restriction.
            // Do not allow users to look up the sky or down the ground.
            // If specified, do not allow users to turn around too much by restricting the heading angle.
            if (pov.pitch > properties.maxPitch) {
                pov.pitch = properties.maxPitch;
            } else if (pov.pitch < properties.minPitch) {
                pov.pitch = properties.minPitch;
            }

            if (properties.minHeading && properties.maxHeading) {
                if (properties.minHeading <= properties.maxHeading) {
                    if (pov.heading > properties.maxHeading) {
                        pov.heading = properties.maxHeading;
                    } else if (pov.heading < properties.minHeading) {
                        pov.heading = properties.minHeading;
                    }
                } else {
                    if (pov.heading < properties.minHeading &&
                        pov.heading > properties.maxHeading) {
                        if (Math.abs(pov.heading - properties.maxHeading) < Math.abs(pov.heading - properties.minHeading)) {
                            pov.heading = properties.maxHeading;
                        } else {
                            pov.heading = properties.minHeading;
                        }
                    }
                }
            }

            //
            // Set the property this object. Then update the Street View image
            properties.panoramaPov = pov;
            svl.panorama.setPov(pov);
        } else {
            throw self.className + ' updatePov(): panorama not defined!';
        }
    }

    /**
     * This method sets the minimum and maximum heading angle that users can adjust the Street View camera.
     * @param range
     * @returns {setHeadingRange}
     */
    function setHeadingRange (range) {
        properties.minHeading = range[0];
        properties.maxHeading = range[1];
        return this;
    }

    /**
     * Set mode.
     * @param modeIn
     * @returns {setMode}
     */
    function setMode (modeIn) {
        properties.mode = modeIn;
        return this;
    }

    /**
     * This method sets the minimum and maximum pitch angle that users can adjust the Street View camera.
     * @param range
     * @returns {setPitchRange}
     */
    function setPitchRange (range) {
        properties.minPitch = range[0];
        properties.maxPitch = range[1];
        return this;
    }

    /**
     * This method changes the Street View pov. If a transition duration is given, the function smoothly updates the
     * pov over the time.
     * @param pov Target pov
     * @param durationMs Transition duration in milli-seconds
     * @param callback Callback function executed after updating pov.
     * @returns {setPov}
     */
    function setPov (pov, durationMs, callback) {
        if (('panorama' in svl) && svl.panorama) {
            var currentPov = svl.panorama.getPov();
            var end = false;
            var interval;

            pov.heading = parseInt(pov.heading, 10);
            pov.pitch = parseInt(pov.pitch, 10);
            pov.zoom = parseInt(pov.zoom, 10);

            //
            // Pov restriction
            if (pov.pitch > properties.maxPitch) {
                pov.pitch = properties.maxPitch;
            } else if (pov.pitch < properties.minPitch) {
                pov.pitch = properties.minPitch;
            }

            if (properties.minHeading && properties.maxHeading) {
                if (properties.minHeading <= properties.maxHeading) {
                    if (pov.heading > properties.maxHeading) {
                        pov.heading = properties.maxHeading;
                    } else if (pov.heading < properties.minHeading) {
                        pov.heading = properties.minHeading;
                    }
                } else {
                    if (pov.heading < properties.minHeading &&
                        pov.heading > properties.maxHeading) {
                        if (Math.abs(pov.heading - properties.maxHeading) < Math.abs(pov.heading - properties.minHeading)) {
                            pov.heading = properties.maxHeading;
                        } else {
                            pov.heading = properties.minHeading;
                        }
                    }
                }
            }

            if (durationMs) {
                var timeSegment = 25; // 25 millisecconds

                // Get how much angle you change over timeSegment of time.
                var cw = (pov.heading - currentPov.heading + 360) % 360;
                var ccw = 360 - cw;
                var headingDelta;
                var headingIncrement;
                if (cw < ccw) {
                    headingIncrement = cw * (timeSegment / durationMs);
                } else {
                    headingIncrement = (-ccw) * (timeSegment / durationMs);
                }

                var pitchIncrement;
                var pitchDelta = pov.pitch - currentPov.pitch;
                pitchIncrement = pitchDelta * (timeSegment / durationMs);


                interval = window.setInterval(function () {
                    var headingDelta = pov.heading - currentPov.heading;
                    if (Math.abs(headingDelta) > 1) {
                        // Update heading angle and pitch angle

                        currentPov.heading += headingIncrement;
                        currentPov.pitch += pitchIncrement;
                        currentPov.heading = (currentPov.heading + 360) % 360; //Math.ceil(currentPov.heading);
                        svl.panorama.setPov(currentPov);
                    } else {
                        // Set the pov to adjust the zoom level. Then clear the interval.
                        // Invoke a callback function if there is one.
                        if (!pov.zoom) {
                            pov.zoom = 1;
                        }

                        svl.panorama.setZoom(pov.zoom);
                        window.clearInterval(interval);
                        if (callback) {
                            callback();
                        }
                    }
                }, timeSegment);


            } else {
                svl.panorama.setPov(pov);
            }
        }

        return this;
    }

    /**
     * This funciton sets the current status of the instantiated object
     * @param key
     * @param value
     * @returns {*}
     */
    function setStatus (key, value) {
        if (key in status) {
            // if the key is disableWalking, invoke walk disabling/enabling function
            if (key === "disableWalking") {
                if (typeof value === "boolean") {
                    if (value) {
                        disableWalking();
                    } else {
                        enableWalking();
                    }
                } else {
                    return false
                }
            } else {
                status[key] = value;
            }
            return this;
        }
        return false;
    }

    /**
     * Show delete menu
     */
    function showDeleteLabelMenu () {
        var item = canvas.isOn(mouseStatus.currX,  mouseStatus.currY);
        if (item && item.className === "Point") {
            var selectedLabel = item.belongsTo().belongsTo();
            if (selectedLabel === canvas.getCurrentLabel()) {
                canvas.showDeleteLabel(mouseStatus.currX, mouseStatus.currY);
            }
        }
    }

    /**
     * Unlock disable panning
     * @returns {unlockDisablePanning}
     */
    function unlockDisablePanning () {
        status.lockDisablePanning = false;
        return this;
    }

    /**
     * Unlock disable walking
     * @returns {unlockDisableWalking}
     */
    function unlockDisableWalking () {
        status.lockDisableWalking = false;
        return this;
    }

    /**
     * Unlock render lables
     * @returns {unlockRenderLabels}
     */
    function unlockRenderLabels () {
        lock.renderLabels = false;
        return this;
    }

    self.blinkGoogleMaps = blinkGoogleMaps;
    self.stopBlinkingGoogleMaps = stopBlinkingGoogleMaps;
    self.disablePanning = disablePanning;
    self.disableWalking = disableWalking;
    self.disableClickZoom = disableClickZoom;
    self.enablePanning = enablePanning;
    self.enableClickZoom = enableClickZoom;
    self.enableWalking = enableWalking;
    self.getInitialPanoId = getInitialPanoId;
    self.getMap = getMap;
    self.getMaxPitch = getMaxPitch;
    self.getMinPitch = getMinPitch;
    self.getPanoId = getPanoId;
    self.getProperty = getProperty;
    self.getPosition = getPosition;
    self.getPov = getPov;
    self.hideLinks = hideLinks;
    self.load = load;
    self.lockDisablePanning = lockDisablePanning;
    self.lockDisableWalking = lockDisableWalking;
    self.lockRenderLabels = lockRenderLabels;
    self.modeSwitchLabelClick = modeSwitchLabelClick;
    self.modeSwitchWalkClick = modeSwitchWalkClick;
    self.plotMarkers = plotMarkers;
    self.save = save;
    self.setHeadingRange = setHeadingRange;
    self.setMode = setMode;
    self.setPitchRange = setPitchRange;
    self.setPosition = setPosition;
    self.setPov = setPov;
    self.setStatus = setStatus;
    self.unlockDisableWalking = unlockDisableWalking;
    self.unlockDisablePanning = unlockDisablePanning;
    self.unlockRenderLabels = unlockRenderLabels;

    _init(params);
    return self;
}

/**
 * This module controls the message shown at the top of the Street View pane.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function OverlayMessageBox () {
    var self = { 'className' : 'OverlayMessageBox' },
        properties = { 'visibility' : 'visible' };

    function init() {
        if ("ui" in svl && svl.ui && svl.ui.overlayMessage) {
          setMessage('Walk');
        }
    }

    /**
     * Set the message in the overlay box
     * @param mode
     * @param message
     * @returns {*}
     */
    function setMessage (mode, message) {
        var instructions = svl.misc.getLabelInstructions(),
            labelColors = svl.misc.getLabelColors();

        if ((mode in instructions) && (mode in labelColors) && "ui" in svl) {
            // Set the box color.
            var modeColor = labelColors[mode];
            var backgroundColor = svl.util.color.changeAlphaRGBA(modeColor.fillStyle, 0.85);
            backgroundColor = svl.util.color.changeDarknessRGBA(backgroundColor, 0.35);


            svl.ui.overlayMessage.box.css({
                'background' : backgroundColor
            });
            svl.ui.overlayMessage.message.css({
                'color' : instructions[mode].textColor
            });

            // Set the instructional message.
            if (message) {
                // Manually set a message.
                svl.ui.overlayMessage.message.html(message);
            } else {
                // Otherwise use the pre set message
                svl.ui.overlayMessage.message.html('<strong>' + instructions[mode].instructionalText + '</strong>');
            }
            return this;
        } else {
            return false;
        }
    }


    /**
     * Set the visibility to visible or hidden.
     * @param val
     * @returns {setVisibility}
     */
    function setVisibility (val) {
        if (val === 'visible' || val === 'hidden') {
            properties.visibility = val;
        }
        return this;
    }

    self.setMessage = setMessage;
    self.setVisibility = setVisibility;

    init();
    return self;
}

/**
 * PointCloud module
 * @param params
 * @constructor
 * @memberof svl
 */
function PointCloud (params) {
    var self = {};
    var _callbacks = {};
    var _pointClouds = {};

    function _init(params) {
        params = params || {};

        // Get initial point clouds
        if ('panoIds' in params && params.panoIds) {
            for (var i = 0; i < params.panoIds.length; i++) {
                createPointCloud(params.panoIds[i]);
            }
        }
    }

    /**
     * This method downloads 3D depth data from Google Street View and creates point cloud data.
     * @param panoId
     */
    function createPointCloud(panoId) {
        if (!(panoId in _pointClouds)) {
            // Download the depth data only if it hasn't been downloaded. First put null in _pointClouds[panoId] so
            // that even while processing the data we don't accidentally download the data again.
            var _pointCloudLoader = new GSVPANO.PanoPointCloudLoader();
            _pointClouds[panoId] = null;
            _pointCloudLoader.onPointCloudLoad = function () {
                _pointClouds[panoId] = this.pointCloud;

                if (panoId in _callbacks) {
                    for (var i = 0; i < _callbacks[panoId].length; i++) {
                        _callbacks[panoId][i]();
                    }
                    _callbacks[panoId] = null;
                }
            };
            _pointCloudLoader.load(panoId);
        }
    }

    /**
     * This method returns point cloud data if it exists. Otherwise it calls createPointCloud to load the data.
     *
     * @param panoId
     * @returns {*}
     */
    function getPointCloud(panoId) {
        if (!(panoId in _pointClouds)) {
            createPointCloud(panoId);
            return null;
        } else {
            return _pointClouds[panoId];
        }
    }

    /**
     * Push a callback function into _callbacks
     * @param func
     */
    function ready(panoId, func) {
        if (!(panoId in _callbacks)) { _callbacks[panoId] = []; }
        _callbacks[panoId].push(func);
    }

    /**
     * Given the coordinate x, y (and z), return index of the point cloud data.
     * To further calculate the x- and y-coordinates, do as follows:
     *
     * ix = idx / 3 % w
     * iy = (idx / 3 - ix) / w
     *
     * @panoId
     * @param x
     * @param y
     * @param param An object that could contain z-coordinate and a distance tolerance (r).
     * @return idx
     */
    function search(panoId, param) {
        if (panoId in _pointClouds && getPointCloud(panoId)){
            var pc = getPointCloud(panoId);

            // kd-tree. It's slooooooow. I'll try Three.js later.
            // https://github.com/ubilabs/kd-tree-javascript
            //var point = pc.tree.nearest({x: param.x, y: param.y, z: param.z}, 1, 100);
            var point = pc.tree.nearest({x: param.x, y: param.y, z: param.z}, 1, 40);
            if (point && point[0]) {
                var idx = point[0][0].id;
                return idx;
                //var ix = idx / 3 % w;
                //var iy = (idx / 3 - ix) / w;
                //return {ix: ix, iy: iy};
            }
        }
        return null;
    }

    self.createPointCloud = createPointCloud;
    self.getPointCloud = getPointCloud;
    self.ready = ready;
    self.search = search;

    _init(params);
    return self;
}
/**
 * A MessageBox module
 * @param $
 * @param param
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function PopUpMessage ($, param) {
    var self = {className: 'PopUpMessage'},
        status = { haveAskedToSignIn: false },
        buttons = [];

    function appendHTML (htmlDom, callback) {
        var $html = $(htmlDom);
        svl.ui.popUpMessage.content.append($html);

        if (callback) {
            $html.on("click", callback);
        }
        $html.on('click', hide);
        buttons.push($html);
    }

    function appendButton (buttonDom, callback) {
        var $button = $(buttonDom);
        $button.css({ margin: '0 10 10 0' });
        $button.addClass('button');
        svl.ui.popUpMessage.buttonHolder.append($button);

        if (callback) {
            $button.one('click', callback);
        }
        $button.one('click', hide);
        buttons.push($button);
    }

    function appendOKButton() {
        var OKButton = '<button id="pop-up-message-ok-button">OK</button>';
        function handleClickOK () {
            if ('tracker' in svl && svl.tracker) svl.tracker.push('PopUpMessage_ClickOk');
            $("#pop-up-message-ok-button").remove();
        }
        appendButton(OKButton, handleClickOK);
    }

    function haveAskedToSignIn () {
        return status.haveAskedToSignIn;
    }

    /**
     * Hides the message box.
     */
    function hide () {
        svl.ui.popUpMessage.holder.removeClass('visible');
        svl.ui.popUpMessage.holder.addClass('hidden');
        hideBackground();  // hide background
        reset();  // reset all the parameters
        return this;
    }

    /**
     * Hides the background
     */
    function hideBackground () {
        svl.ui.popUpMessage.holder.css({ width: '', height: '' });
    }

    /**
     * Prompt a user who's not logged in to sign up/sign in.
     * Todo. I should move this to either User.js or a new module (e.g., SignUp.js?).
     */
    function promptSignIn () {
        svl.ui.popUpMessage.buttonHolder.html("");
        setTitle("You've been contributing a lot!");
        setMessage("Do you want to create an account to keep track of your progress?");
        appendButton('<button id="pop-up-message-sign-up-button" class="float">Let me sign up!</button>', function () {
            // Store the data in LocalStorage.
            var task = svl.taskContainer.getCurrentTask();
            var data = svl.form.compileSubmissionData(task),
                staged = svl.storage.get("staged");
            staged.push(data);
            svl.storage.set("staged", staged);

            $("#sign-in-modal").addClass("hidden");
            $("#sign-up-modal").removeClass("hidden");
            $('#sign-in-modal-container').modal('show');
        });
        appendButton('<button id="pop-up-message-cancel-button" class="float">No</button>', function () {
            if (!('user' in svl)) { svl.user = new User({username: 'anonymous'}); }

            svl.user.setProperty('firstTask', false);
            // Submit the data as an anonymous user.
            var task = svl.taskContainer.getCurrentTask();
            var data = svl.form.compileSubmissionData(task);
            svl.form.submit(data, task);
        });
        appendHTML('<br class="clearBoth"/><p><a id="pop-up-message-sign-in"><small><span style="text-decoration: underline;">I do have an account! Let me sign in.</span></small></a></p>', function () {
            var task = svl.taskContainer.getCurrentTask();
            var data = svl.form.compileSubmissionData(task),
                staged = svl.storage.get("staged");
            staged.push(data);
            svl.storage.set("staged", staged);

            $("#sign-in-modal").removeClass("hidden");
            $("#sign-up-modal").addClass("hidden");
            $('#sign-in-modal-container').modal('show');
        });
        setPosition(40, 260, 640);
        show(true);
        status.haveAskedToSignIn = true;
    }

    function notify(title, message) {
        svl.ui.popUpMessage.buttonHolder.html("");
        setPosition(40, 260, 640);
        show(true);
        setTitle(title);
        setMessage(message);
        appendOKButton();
    }

    /**
     * Reset all the parameters.
     */
    function reset () {
        svl.ui.popUpMessage.holder.css({ width: '', height: '' });
        svl.ui.popUpMessage.foreground.css({
                    left: '',
                    top: '',
                    width: '',
                    height: '',
                    zIndex: ''
                });

        svl.ui.popUpMessage.foreground.css('padding-bottom', '')

        for (var i = 0; i < buttons.length; i++ ){
            try {
                buttons[i].remove();
            } catch (e) {
                console.warning("Button does not exist.", e);
            }
        }
        buttons = [];
    }

    /**
     * This method shows a messaage box on the page.
     */
    function show (disableOtherInteraction) {
        if (disableOtherInteraction) {
            showBackground();
        }

        svl.ui.popUpMessage.holder.removeClass('hidden');
        svl.ui.popUpMessage.holder.addClass('visible');
        return this;
    }

    /**
     * Show a semi-transparent background to block people to interact with
     * other parts of the interface.
     */
    function showBackground () {
        svl.ui.popUpMessage.holder.css({ width: '100%', height: '100%'});
    }

    /**
     * Sets the title
     */
    function setTitle (title) {
         svl.ui.popUpMessage.title.html(title);
         return this;
    }

    /**
     * Sets the message.
     */
    function setMessage (message) {
        svl.ui.popUpMessage.content.html(message);
        return this;
    }

    /*
     * Sets the position of the message.
     */
    function setPosition (x, y, width, height) {
        svl.ui.popUpMessage.foreground.css({
            left: x,
            top: y,
            width: width,
            height: height,
            zIndex: 2
        });
        return this;
    }

    self.haveAskedToSignIn = haveAskedToSignIn;
    self.hide = hide;
    self.hideBackground = hideBackground;
    self.notify = notify;
    self.promptSignIn = promptSignIn;
    self.reset = reset;
    self.show = show;
    return self;
}

/**
 *
 * @param $
 * @param params
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function RibbonMenu ($, params) {
    var self = { className: 'RibbonMenu'},
        properties = {
            borderWidth : "3px",
            modeSwitchDefaultBorderColor : "rgba(200,200,200,0.75)",
            originalBackgroundColor: "white"
        },
        status = {
            disableModeSwitch: false,
            lockDisableModeSwitch: false,
            mode: 'Walk',
            selectedLabelType: undefined
        },
        blinkInterval;

    function _init () {
        var browser = getBrowser(), labelColors = svl.misc.getLabelColors();
        if (browser === 'mozilla') {
            properties.originalBackgroundColor = "-moz-linear-gradient(center top , #fff, #eee)";
        } else if (browser === 'msie') {
            properties.originalBackgroundColor = "#ffffff";
        } else {
            properties.originalBackgroundColor = "-webkit-gradient(linear, left top, left bottom, from(#fff), to(#eee))";
        }

        // Initialize the jQuery DOM elements
        if (svl.ui && svl.ui.ribbonMenu) {
            // Initialize the color of the lines at the bottom of ribbon menu icons
            $.each(svl.ui.ribbonMenu.bottonBottomBorders, function (i, v) {
                var labelType = $(v).attr("val"), color = labelColors[labelType].fillStyle;
                if (labelType === 'Walk') { $(v).css('width', '56px'); }

                $(v).css('border-top-color', color);
                $(v).css('background', color);
            });

            setModeSwitchBorderColors(status.mode);
            setModeSwitchBackgroundColors(status.mode);

            svl.ui.ribbonMenu.buttons.bind({
                click: handleModeSwitchClickCallback,
                mouseenter: handleModeSwitchMouseEnter,
                mouseleave: handleModeSwitchMouseLeave
            });
            svl.ui.ribbonMenu.subcategories.on({
               click: handleSubcategoryClick
            });
        }

        // Disable mode switch when sign in modal is open
        if ($("#sign-in-modal-container").length != 0) {
            var $signInModalTextBoxes = $("#sign-in-modal-container input[type='text']"),
                $signInModalPassword = $("#sign-in-modal-container input[type='password']");
            $signInModalTextBoxes.on('focus', disableModeSwitch);
            $signInModalTextBoxes.on('blur', enableModeSwitch);
            $signInModalPassword.on('focus', disableModeSwitch);
            $signInModalPassword.on('blur', enableModeSwitch);
        }


        // Handle info button click
        svl.ui.ribbonMenu.informationButtons.on("click", handleInfoButtonClick);
    }

    /**
     * This is a callback method that is invoked with a ribbon menu button click
     * @param mode
     */
    function modeSwitch (mode) {
        var labelType = (typeof mode === 'string') ? mode : $(this).attr("val"); // Do I need this???
        svl.tracker.push('ModeSwitch_' + labelType);
        if (status.disableModeSwitch === false) {
            var labelColors, ribbonConnectorPositions, borderColor;

            // Whenever the ribbon menu is clicked, cancel drawing.
            if ('canvas' in svl && svl.canvas && svl.canvas.isDrawing()) {
                svl.canvas.cancelDrawing();
            }

            labelColors = svl.misc.getLabelColors();
            ribbonConnectorPositions = svl.misc.getRibbonConnectionPositions();
            borderColor = labelColors[labelType].fillStyle;

            if ('map' in svl && svl.map) {
                if (labelType === 'Walk') {
                    // Switch to walking mode.
                    setStatus('mode', 'Walk');
                    setStatus('selectedLabelType', undefined);
                    if (svl.map) { svl.map.modeSwitchWalkClick(); }
                } else {
                    // Switch to labeling mode.
                    setStatus('mode', labelType);
                    setStatus('selectedLabelType', labelType);
                    if (svl.map) { svl.map.modeSwitchLabelClick(); }
                }
            }

            if (svl.ui && svl.ui.ribbonMenu) {
                setModeSwitchBorderColors(labelType);
                setModeSwitchBackgroundColors(labelType);


                svl.ui.ribbonMenu.connector.css("left", ribbonConnectorPositions[labelType].labelRibbonConnection);
                svl.ui.ribbonMenu.connector.css("border-left-color", borderColor);
                svl.ui.ribbonMenu.streetViewHolder.css("border-color", borderColor);
            }

            // Set the instructional message
            if (svl.overlayMessageBox) { svl.overlayMessageBox.setMessage(labelType); }

            // Play an audio effect
            if ('audioEffect' in svl) { svl.audioEffect.play('glug1'); }
        }
    }

    function handleInfoButtonClick (e) {
        e.stopPropagation();
        if ("modalExample" in svl) {
            var category = $(this).attr("val");
            svl.modalExample.show(category);
        }
    }

    function handleSubcategoryClick (e) {
        e.stopPropagation();
        var subcategory = $(this).attr("val");
        svl.tracker.push('Click_Subcategory_' + subcategory);
        modeSwitch(subcategory);
        hideSubcategories();
    }

    function handleModeSwitchClickCallback () {
        if (status.disableModeSwitch === false) {
            var labelType = $(this).attr('val');

            // If allowedMode is not null/undefined, only accept the specified mode (e.g., 'walk')
            if (status.allowedMode && status.allowedMode !== labelType) { return false; }

            if (labelType === "Other") { return false; }  // Disable clicking "Other"

            // Track the user action
            svl.tracker.push('Click_ModeSwitch_' + labelType);
            modeSwitch(labelType);
        }
    }

    function handleModeSwitchMouseEnter () {
        if (status.disableModeSwitch === false) {
            // Change the background color and border color of menu buttons
            // But if there is no Bus Stop label, then do not change back ground colors.
            var labelType = $(this).attr("val");

            // If allowedMode is not null/undefined, only accept the specified mode (e.g., 'walk')
            if (status.allowedMode && status.allowedMode !== labelType) { return false; }
            setModeSwitchBackgroundColors(labelType);
            setModeSwitchBorderColors(labelType);

            if (labelType === "Other") { showSubcategories(); }
        }
    }

    function handleModeSwitchMouseLeave () {
        if (status.disableModeSwitch === false) {
            setModeSwitchBorderColors(status.mode);
            setModeSwitchBackgroundColors(status.mode);
            hideSubcategories();
        }
    }

    function hideSubcategories () {
        svl.ui.ribbonMenu.subcategoryHolder.css('visibility', 'hidden');
    }

    function setModeSwitchBackgroundColors (mode) {
        // background: -moz-linear-gradient(center top , #fff, #eee);
        // background: -webkit-gradient(linear, left top, left bottom, from(#fff), to(#eee));
        if ("ui" in svl && svl.ui && svl.ui.ribbonMenu) {
          var labelType;
          var labelColors;
          var borderColor;
          var browser;
          var backgroundColor;

          labelColors = svl.misc.getLabelColors();
          borderColor = labelColors[mode].fillStyle;

          $.each(svl.ui.ribbonMenu.buttons, function (i, v) {
              labelType = $(v).attr("val");
              if (labelType === mode) {
                  if (labelType === 'Walk') {
                      backgroundColor = "#ccc";
                  } else {
                      backgroundColor = borderColor;
                  }
                  $(this).css({
                      "background" : backgroundColor
                  });
              } else {
                  backgroundColor = properties.originalBackgroundColor;
                  if (labelType !== status.mode) {
                      // Change background color if the labelType is not the currently selected mode.
                      $(this).css({
                          "background" : backgroundColor
                      });
                  }
              }
          });
      }
      return this;
    }

    function setModeSwitchBorderColors (mode) {
        // This method sets the border color of the ribbon menu buttons
        if (svl.ui && svl.ui.ribbonMenu) {
          var labelType, labelColors, borderColor;
          labelColors = svl.misc.getLabelColors();
          borderColor = labelColors[mode].fillStyle;

          $.each(svl.ui.ribbonMenu.buttons, function (i, v) {
              labelType = $(v).attr("val");
              if (labelType=== mode) {
                  $(this).css({
                      "border-color" : borderColor,
                      "border-style" : "solid",
                      "border-width": properties.borderWidth
                  });
              } else {
                  if (labelType !== status.mode) {
                      // Change background color if the labelType is not the currently selected mode.
                      $(this).css({
                          "border-color" : properties.modeSwitchDefaultBorderColor,
                          "border-style" : "solid",
                          "border-width": properties.borderWidth
                      });

                  }
              }
          });
        }
        return this;
    }

    function showSubcategories () {
        svl.ui.ribbonMenu.subcategoryHolder.css('visibility', 'visible');
    }

    /**
     * Changes the mode to "walk"
     * @returns {backToWalk}
     */
    function backToWalk () {
        modeSwitch('Walk');
        return this;
    }

    /**
     * Disable switching modes
     * @returns {disableModeSwitch}
     */
    function disableModeSwitch () {
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = true;
            if (svl.ui && svl.ui.ribbonMenu) {
                svl.ui.ribbonMenu.buttons.css('opacity', 0.5);
            }
        }
        return this;
    }

    /**
     * This function dims landmark labels and also set status.disableLandmarkLabels to true
     * @returns {disableLandmarkLabels}
     */
    function disableLandmarkLabels () {
        if (svl.ui && svl.ui.ribbonMenu) {
            $.each(svl.ui.ribbonMenu.buttons, function (i, v) {
                var labelType = $(v).attr("val");
                if (!(labelType === 'Walk' ||
                    labelType === 'StopSign' ||
                    labelType === 'Landmark_Shelter')
                ) {
                    $(v).css('opacity', 0.5);
                }
            });
        }
        status.disableLandmarkLabels = true;
        return this;
    }

    /**
     * This method enables mode switch.
     * @returns {enableModeSwitch}
     */
    function enableModeSwitch () {
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = false;
            if (svl.ui && svl.ui.ribbonMenu && svl.ui.ribbonMenu.buttons) {
                svl.ui.ribbonMenu.buttons.css('opacity', 1);
            }
        }
        return this;
    }

    /**
     * Enable clicking landmark buttons
     * @returns {enableLandmarkLabels}
     */
    function enableLandmarkLabels () {
        if (svl.ui && svl.ui.ribbonMenu) {
            $.each(svl.ui.ribbonMenu.buttons, function (i, v) {
                $(v).css('opacity', 1);
            });
        }
        status.disableLandmarkLabels = false;
        return this;
    }

    function lockDisableModeSwitch () {
        status.lockDisableModeSwitch = true;
        return this;
    }

    function getStatus (key) {
        if (key in status) {
            return status[key];
        } else {
            console.warn(self.className, 'You cannot access a property "' + key + '".');
            return undefined;
        }
    }

    function getProperty(key) {
        return key in properties ? properties[key] : null;
    }

    function setAllowedMode (mode) {
        // This method sets the allowed mode.
        status.allowedMode = mode;
        return this;
    }

    function setStatus (name, value) {
        try {
            if (name in status) {
                if (name === 'disableModeSwitch') {
                    if (typeof value === 'boolean') {
                        if (value) {
                            disableModeSwitch();
                        } else {
                            enableModeSwitch();
                        }
                        return this;
                    } else {
                        return false
                    }
                } else {
                    status[name] = value;
                    return this;
                }
            } else {
                var errMsg = '"' + name + '" is not a modifiable status.';
                throw errMsg;
            }
        } catch (e) {
            console.error(self.className, e);
            return false;
        }

    }

    function startBlinking (labelType, subLabelType) {
        var highlighted = false,
            button = svl.ui.ribbonMenu.holder.find('[val="' + labelType + '"]').get(0),
            dropdown;

        if (subLabelType) {
            dropdown = svl.ui.ribbonMenu.subcategoryHolder.find('[val="' + subLabelType + '"]').get(0);
        }

        stopBlinking();
        if (button) {
            blinkInterval = window.setInterval(function () {
                if (highlighted) {
                    highlighted = !highlighted;
                    $(button).css("background", "rgba(255, 255, 0, 1)");
                    if (dropdown) {
                        $(dropdown).css("background", "rgba(255, 255, 0, 1)");
                    }
                    // $(button).css("background", "rgba(255, 255, 166, 1)");
                    // if (dropdown) {
                    //     $(dropdown).css("background", "rgba(255, 255, 166, 1)");
                    // }
                } else {
                    highlighted = !highlighted;
                    $(button).css("background", getProperty("originalBackgroundColor"));
                    if (dropdown) {
                        $(dropdown).css("background", "white");
                    }
                }
            }, 500);
        }
    }


    function stopBlinking () {
        clearInterval(blinkInterval);
        svl.ui.ribbonMenu.buttons.css("background",getProperty("originalBackgroundColor"));
        svl.ui.ribbonMenu.subcategories.css("background", "white");
    }

    function unlockDisableModeSwitch () {
        status.lockDisableModeSwitch = false;
        return this;
    }

    self.backToWalk = backToWalk;
    self.disableModeSwitch = disableModeSwitch;
    self.disableLandmarkLabels = disableLandmarkLabels;
    self.enableModeSwitch = enableModeSwitch;
    self.enableLandmarkLabels = enableLandmarkLabels;
    self.lockDisableModeSwitch = lockDisableModeSwitch;
    self.modeSwitch = modeSwitch;
    self.modeSwitchClick = modeSwitch;
    self.getStatus = getStatus;
    self.setAllowedMode = setAllowedMode;
    self.setStatus = setStatus;
    self.startBlinking = startBlinking;
    self.stopBlinking = stopBlinking;
    self.unlockDisableModeSwitch = unlockDisableModeSwitch;


    _init(params);

    return self;
}

/**
 * Storage module. This is a wrapper around web browser's Local Storage. It allows you to store data on the user's
 * broser using a set method, and you can retrieve the data using the get method.
 *
 * Refrernces:
 * https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
 *
 * @param JSON
 * @param params
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Storage(JSON, params) {
    var self = {'className': 'Storage'};

    if (params && 'storage' in params && params.storage == 'session') {
        self.storage = window.sessionStorage;
    } else {
        self.storage = window.localStorage;
    }

    function _init () {
        // Create an array to store staged submission data (if there hasn't been one)
        if (!get("staged")) {
            set("staged", []);
        }

        // Create an object to store current status.
        if (!get("tracker")) {
            set("tracker", []);
        }

        if (!get("labels")) {
            set("labels", []);
        }

        if (!get("completedOnboarding")) {
            set("completedOnboarding", null);
        }
    }

    /**
     * Returns the item specified by the key
     * @param key
     */
    function get(key) {
        return JSON.parse(self.storage.getItem(key));
    }

    /**
     * Refresh
     */
    function clear () {
        _init();
        set("staged", []);
        set("tracker", []);
        set("labels", []);
        set("completedOnboarding", null);
    }

    /**
     * Stores a key value pair
     * @param key
     * @param value
     */
    function set(key, value) {
        self.storage.setItem(key, JSON.stringify(value));
    }

    self.get = get;
    self.clear = clear;
    self.set = set;
    _init();
    return self;
}
/**
 *
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Tracker () {
    var self = {className: 'Tracker'},
        actions = [],
        prevActions = [];

    
    /** Returns actions */
    function getActions () { return actions; }

    /**
     * This function pushes action type, time stamp, current pov, and current panoId into actions list.
     */
    function push (action, param) {
        var pov, latlng, panoId, note, temporaryLabelId;

        if (param) {
            if (('x' in param) && ('y' in param)) {
                note = 'x:' + param.x + ',y:' + param.y;
            } else if ('TargetPanoId' in param) {
                note = "targetPanoId:" + param.TargetPanoId;
            } else if ('RadioValue' in param) {
                note = "RadioValue:" + param.RadioValue;
            } else if ('keyCode' in param) {
                note = 'keyCode:' + param.keyCode;
            } else if ('errorType' in param) {
                note = 'errorType:' + param.errorType;
            } else if ('quickCheckImageId' in param) {
                note = param.quickCheckImageId;
            } else if ('quickCheckCorrectness' in param) {
                note = param.quickCheckCorrectness;
            } else if ('labelId' in param) {
                note = 'labelId:' + param.labelId;
            } else if ("checked" in param) {
                note = "checked:" + param.checked;
            } else if ("onboardingTransition" in param) {
                note = "from:" + param.onboardingTransition;
            } else {
                note = "";
            }
            note = note + "";  // Make sure it is a string.

            if ("LabelType" in param && "canvasX" in param && "canvasY" in param) {
                if (note.length != 0) { note += ","; }
                note += "labelType:" + param.LabelType + ",canvasX:" + param.canvasX + ",canvasY:" + param.canvasY;
            }
            if ('temporary_label_id' in param) {
                temporaryLabelId = param.temporary_label_id;
            }
        } else {
            note = "";
        }

        // Initialize variables. Note you cannot get pov, panoid, or position
        // before the map and SV load.
        try {
            pov = svl.map.getPov();
        } catch (err) {
            pov = {
                heading: null,
                pitch: null,
                zoom: null
            }
        }

        try {
            latlng = svl.map.getPosition();
        } catch (err) {
            latlng = {
                lat: null,
                lng: null
            };
        }
        if (!latlng) {
            latlng = {
                lat: null,
                lng: null
            };
        }

        try {
            panoId = svl.map.getPanoId();
        } catch (err) {
            panoId = null;
        }

        var now = new Date(),
            timestamp = now.getUTCFullYear() + "-" + (now.getUTCMonth() + 1) + "-" + now.getUTCDate() + " " + now.getUTCHours() + ":" + now.getUTCMinutes() + ":" + now.getUTCSeconds() + "." + now.getUTCMilliseconds();

        var item = {
            action : action,
            gsv_panorama_id: panoId,
            lat: latlng.lat,
            lng: latlng.lng,
            heading: pov.heading,
            pitch: pov.pitch,
            zoom: pov.zoom,
            note: note,
            temporary_label_id: temporaryLabelId,
            timestamp: timestamp
        };
        actions.push(item);

        // Submit the data collected thus far if actions is too long.
        if (actions.length > 30) {
            var task = svl.taskContainer.getCurrentTask();
            var data = svl.form.compileSubmissionData(task);
            svl.form.submit(data, task);
        }

        if ("trackerViewer" in svl) {
            svl.trackerViewer.add(item)
        }

        return this;
    }

    /**
     * Put the previous labeling actions into prevActions. Then refresh the current actions.
     */
    function refresh () {
        prevActions = prevActions.concat(actions);
        actions = [];
        push("RefreshTracker");
    }
    
    self.getActions = getActions;
    self.push = push;
    self.refresh = refresh;
    return self;
}


function TrackerViewer () {
    var self = { className: "TrackerViewer" },
        items = [];

    function add (action) {
        if (action.action == "LabelingCanvas_FinishLabeling") {
            var notes = action.note.split(","),
                pov = {heading: action.heading, pitch: action.pitch, zoom: action.zoom},
                imageCoordinates;

            var labelType, canvasX, canvasY, i, len = notes.length;
            for (i = 0; i < len; i++) {
                if (notes[i].indexOf("canvasX") >= 0) {
                    canvasX = parseInt(notes[i].split(":")[1], 10);
                } else if (notes[i].indexOf("canvasY") >= 0) {
                    canvasY = parseInt(notes[i].split(":")[1], 10);
                } else if (notes[i].indexOf("labelType") >= 0) {
                    labelType = notes[i].split(":")[1];
                }
            }

            imageCoordinates = svl.misc.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov);

            items.push({
                action: action.action,
                panoId: action.gsv_panorama_id,
                labelType: labelType,
                imageX: imageCoordinates.x,
                imageY: imageCoordinates.y
            });
        }

        update();
    }

    function dump () {
        return items;
    }

    function update () {
        var i, len, item, html = "";
        len = items.length;

        for (i = 0; i < len; i ++) {
            item = items[i];
            html += "<li><small>action:" + item.action +
                ", panoId:" + item.panoId +
                ", labelType:" + item.labelType +
                ", imageX:" + Math.round(item.imageX) +
                ", imageY:" + Math.round(item.imageY) + "</small></li>"
        }
        svl.ui.tracker.itemHolder.html(html);
    }

    self.add = add;
    self.dump = dump;
    return self;
}

/**
 * User module.
 * Todo. Need to move user related information here.
 * @param param
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function User (param) {
    var self = {className: 'User'},
        properties = {
            username: null,
            recordedAuditDistance: null  // miles.
        };

    properties.username = param.username;


    /**
     * Get a property
     * @param key
     * @returns {*}
     */
    function getProperty (key) { 
        return properties[key]; 
    }

    /**
     * Set a property
     * @param key
     * @param value
     */
    function setProperty (key, value) {
        properties[key] = value;
    }

    self.getProperty = getProperty;
    self.setProperty = setProperty;

    return self;
}

/**
 *
 * @param $ jQuery object
 * @param param Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ZoomControl ($, param) {
    var self = { 'className' : 'ZoomControl' },
        properties = {
            maxZoomLevel: 3,
            minZoomLevel: 1
        },
        status = {
            disableZoomIn: false,
            disableZoomOut: false
        },
        lock = {
            disableZoomIn: false,
            disableZoomOut: false
        },
        blinkInterval;

    function _init (param) {
        // Initialization function

        //if ('domIds' in param) {
        if (svl.ui && svl.ui.zoomControl) {
          svl.ui.zoomControl.zoomIn.bind('click', handleZoomInButtonClick);
          svl.ui.zoomControl.zoomOut.bind('click', handleZoomOutButtonClick);
        }
    }

    /**
     * Blink the zoom in and zoom-out buttons
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            svl.ui.zoomControl.zoomIn.toggleClass("highlight-50");
            svl.ui.zoomControl.zoomOut.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Disables zooming in
     * @method
     * @returns {self}
     */
    function disableZoomIn () {
        if (!lock.disableZoomIn) {
            status.disableZoomIn = true;
            if (svl.ui.zoomControl.zoomIn) {
                svl.ui.zoomControl.zoomIn.css('opacity', 0.5);
            }
        }
        return this;
    }

    /**
     * Enable zoom out
     */
    function disableZoomOut () {
        if (!lock.disableZoomOut) {
            status.disableZoomOut = true;
            if (svl.ui.zoomControl.zoomOut) {
                svl.ui.zoomControl.zoomOut.css('opacity', 0.5);
            }
        }
        return this;
    }

    /**
     * Enable zoom in
     */
    function enableZoomIn () {
        if (!lock.disableZoomIn) {
            status.disableZoomIn = false;
            if (svl.ui.zoomControl.zoomIn) {
                svl.ui.zoomControl.zoomIn.css('opacity', 1);
            }
        }
        return this;
    }

    /**
     * Enable zoom out
     */
    function enableZoomOut () {
        if (!lock.disableZoomOut) {
            status.disableZoomOut = false;
            if (svl.ui.zoomControl.zoomOut) {
                svl.ui.zoomControl.zoomOut.css('opacity', 1);
            }
        }
        return this;
    }

    /**
     * Get lock
     * @param name
     * @returns {*}
     */
    function getLock (name) {
        if (name in lock) {
            return lock[name];
        } else {
            throw 'You cannot access a property "' + name + '".';
        }
    }

    /**
     * Get status
     * @param name
     * @returns {*}
     */
    function getStatus (name) {
        if (name in status) {
            return status[name];
        } else {
            throw 'You cannot access a property "' + name + '".';
        }
    }

    /** Get a property.*/
    function getProperty (name) {
        if (name in properties) {
            return properties[name];
        } else {
            throw 'You cannot access a property "' + name + '".';
        }
    }

    /** Lock zoom in */
    function lockDisableZoomIn () {
        lock.disableZoomIn = true;
        return this;
    }

    /** Lock zoom out */
    function lockDisableZoomOut () {
        lock.disableZoomOut = true;
        return this;
    }

    /**
     * This is a callback function for zoom-in button. This function increments a sv zoom level.
     */
    function handleZoomInButtonClick () {
        if ('tracker' in svl)  svl.tracker.push('Click_ZoomIn');

        if (!status.disableZoomIn) {
            var pov = svl.panorama.getPov();
            setZoom(pov.zoom + 1);
            svl.canvas.clear().render2();
        }
    }

    /**
     * This is a callback function for zoom-out button. This function decrements a sv zoom level.
     */
    function handleZoomOutButtonClick () {
        if ('traker' in svl)  svl.tracker.push('Click_ZoomOut');

        if (!status.disableZoomOut) {
            var pov = svl.panorama.getPov();
            setZoom(pov.zoom - 1);
            svl.canvas.clear().render2();
        }
    }

    /**
     * This method takes a (x, y) canvas point and zoom in to that point.
     * @param x canvaz x coordinate
     * @param y canvas y coordinate
     * @returns {*}
     */
    function pointZoomIn (x, y) {
        if (!status.disableZoomIn) {
            // Cancel drawing when zooming in or out.
            if ('canvas' in svl) {
              svl.canvas.cancelDrawing();
            }
            if ('panorama' in svl) {
                var currentPov = svl.panorama.getPov(),
                    currentZoomLevel = currentPov.zoom,
                    width = svl.canvasWidth, height = svl.canvasHeight,
                    minPitch, maxPitch,
                    zoomFactor, deltaHeading, deltaPitch, pov = {};
                if (currentZoomLevel >= properties.maxZoomLevel) return false;

                zoomFactor = currentZoomLevel; // This needs to be fixed as it wouldn't work above level 3.
                deltaHeading = (x - (width / 2)) / width * (90 / zoomFactor); // Ugh. Hard coding.
                deltaPitch = - (y - (height / 2)) / height * (70 / zoomFactor); // Ugh. Hard coding.

                pov.zoom = currentZoomLevel + 1;
                pov.heading = currentPov.heading + deltaHeading;
                pov.pitch = currentPov.pitch + deltaPitch;

                // Adjust the pitch angle.
                maxPitch = svl.map.getMaxPitch();
                minPitch = svl.map.getMinPitch();
                if (pov.pitch > maxPitch) {
                    pov.pitch = maxPitch;
                } else if (pov.pitch < minPitch) {
                    pov.pitch = minPitch;
                }

                // Adjust the pitch so it won't exceed max/min pitch.
                svl.panorama.setPov(pov);
                return currentZoomLevel;
            } else {
                return false;
            }
        } else {
            return false;
        }
    }

    /**
     * This method sets the zoom level of the Street View.
     */
    function setZoom (zoomLevelIn) {
        if (typeof zoomLevelIn !== "number") { return false; }

        // Cancel drawing when zooming in or out.
        if ('canvas' in svl) { svl.canvas.cancelDrawing(); }

        // Set the zoom level and change the panorama properties.
        var zoomLevel = undefined;
        zoomLevelIn = parseInt(zoomLevelIn);
        if (zoomLevelIn < 1) {
            zoomLevel = 1;
        } else if (zoomLevelIn > properties.maxZoomLevel) {
            zoomLevel = properties.maxZoomLevel;
        } else {
            zoomLevel = zoomLevelIn;
        }
        svl.panorama.setZoom(zoomLevel);
        return zoomLevel;
    }

    /**
     * Stop blinking the zoom-in and zoom-out buttons
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        svl.ui.zoomControl.zoomIn.removeClass("highlight-50");
        svl.ui.zoomControl.zoomOut.removeClass("highlight-50");
    }



    /**
     * This method sets the maximum zoom level.
     */
    function setMaxZoomLevel (zoomLevel) {
        properties.maxZoomLevel = zoomLevel;
        return this;
    }

    /** This method sets the minimum zoom level. */
    function setMinZoomLevel (zoomLevel) {
        properties.minZoomLevel = zoomLevel;
        return this;
    }

    /** Lock zoom in */
    function unlockDisableZoomIn () {
        lock.disableZoomIn = false;
        return this;
    }

    /** Lock zoom out */
    function unlockDisableZoomOut () {
        lock.disableZoomOut = false;
        return this;
    }

    /**
     * Change the opacity of zoom buttons
     * @returns {updateOpacity}
     */
    function updateOpacity () {
        var pov = svl.map.getPov();

        if (pov) {
            var zoom = pov.zoom;
            // Change opacity
            if (zoom >= properties.maxZoomLevel) {
                svl.ui.zoomControl.zoomIn.css('opacity', 0.5);
                svl.ui.zoomControl.zoomOut.css('opacity', 1);
            } else if (zoom <= properties.minZoomLevel) {
                svl.ui.zoomControl.zoomIn.css('opacity', 1);
                svl.ui.zoomControl.zoomOut.css('opacity', 0.5);
            } else {
                svl.ui.zoomControl.zoomIn.css('opacity', 1);
                svl.ui.zoomControl.zoomOut.css('opacity', 1);
            }
        }

        // If zoom in and out are disabled, fade them out anyway.
        if (status.disableZoomIn) { svl.ui.zoomControl.zoomIn.css('opacity', 0.5); }
        if (status.disableZoomOut) { svl.ui.zoomControl.zoomOut.css('opacity', 0.5); }
        return this;
    }

    /** Zoom in */
    function zoomIn () {
        if (!status.disableZoomIn) {
            var pov = svl.panorama.getPov();
            setZoom(pov.zoom + 1);
            svl.canvas.clear().render2();
            return this;
        } else {
            return false;
        }
    }

    /** Zoom out */
    function zoomOut () {
        // This method is called from outside this class to zoom out from a GSV image.
        if (!status.disableZoomOut) {
            // ViewControl_ZoomOut
            var pov = svl.panorama.getPov();
            setZoom(pov.zoom - 1);
            svl.canvas.clear().render2();
            return this;
        } else {
            return false;
        }
    }

    self.blink = blink;
    self.disableZoomIn = disableZoomIn;
    self.disableZoomOut = disableZoomOut;
    self.enableZoomIn = enableZoomIn;
    self.enableZoomOut = enableZoomOut;
    self.getLock = getLock;
    self.getStatus = getStatus;
    self.getProperties = getProperty; // Todo. Change getProperties to getProperty.
    self.lockDisableZoomIn = lockDisableZoomIn;
    self.lockDisableZoomOut = lockDisableZoomOut;
    self.stopBlinking = stopBlinking;
    self.updateOpacity = updateOpacity;
    self.pointZoomIn = pointZoomIn;
    self.setMaxZoomLevel = setMaxZoomLevel;
    self.setMinZoomLevel = setMinZoomLevel;
    self.unlockDisableZoomIn = unlockDisableZoomIn;
    self.unlockDisableZoomOut = unlockDisableZoomOut;
    self.zoomIn = zoomIn;
    self.zoomOut = zoomOut;

    _init(param);

    return self;
}

/**
 * Task module.
 * @param turf
 * @param geojson
 * @param currentLat
 * @param currentLng
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Task (turf, geojson, currentLat, currentLng) {
    var self = {className: 'Task'},
        _geojson,
        lat,
        lng,
        lastLat,
        lastLng,
        taskCompletionRate = 0,
        paths, previousPaths = [],
        status = {
            isCompleted: false
        },
        properties = {
            auditTaskId: null,
            streetEdgeId: null
        };

    /**
     * This method takes a task parameters and set up the current task.
     * @param geojson Description of the next task in json format.
     * @param currentLat Current latitude
     * @param currentLng Current longitude
     */
    function _init (geojson, currentLat, currentLng) {
        var len = geojson.features[0].geometry.coordinates.length - 1,
            lat1 = geojson.features[0].geometry.coordinates[0][1],
            lng1 = geojson.features[0].geometry.coordinates[0][0],
            lat2 = geojson.features[0].geometry.coordinates[len][1],
            lng2 = geojson.features[0].geometry.coordinates[len][0];
        _geojson = geojson;

        setProperty("streetEdgeId", _geojson.features[0].properties.street_edge_id);

        if (currentLat && currentLng) {
            // Continuing from the previous task (i.e., currentLat and currentLng exist).
            var d1 = svl.util.math.haversine(lat1, lng1, currentLat, currentLng),
                d2 = svl.util.math.haversine(lat2, lng2, currentLat, currentLng);

            if (d2 < d1) reverseCoordinates();
        }

        lat = _geojson.features[0].geometry.coordinates[0][1];
        lng = _geojson.features[0].geometry.coordinates[0][0];

        paths = null;
    }

    /**
     * Get the index of the segment in the line that is closest to the point
     * @param point A geojson Point feature
     * @param line A geojson LineString Feature
     */
    function closestSegment(point, line) {
        var coords = line.geometry.coordinates,
            lenCoord = coords.length,
            segment, lengthArray = [], minValue;

        for (var i = 0; i < lenCoord - 1; i++) {
            segment = turf.linestring([ [coords[i][0], coords[i][1]], [coords[i + 1][0], coords[i + 1][1]] ]);
            lengthArray.push(pointSegmentDistance(point, segment));
        }
        minValue = Math.min.apply(null, lengthArray);
        return lengthArray.indexOf(minValue);
    }


    /**
     * Set the isCompleted status to true
     * @returns {complete}
     */
    function complete () {
        status.isCompleted = true;
        return this;
    }


    function completedTaskPaths () {
        var i,
            newPaths,
            latlng = svl.map.getPosition(),
            lat = latlng.lat,
            lng = latlng.lng,
            line = _geojson.features[0],
            currentPoint = turf.point([lng, lat]),
            snapped = turf.pointOnLine(line, currentPoint),
            closestSegmentIndex = closestSegment(currentPoint, line),
            coords = line.geometry.coordinates,
            segment,
            completedPath = [new google.maps.LatLng(coords[0][1], coords[0][0])],
            incompletePath = [];
        for (i = 0; i < closestSegmentIndex; i++) {
            segment = turf.linestring([ [coords[i][0], coords[i][1]], [coords[i + 1][0], coords[i + 1][1]] ]);
            completedPath.push(new google.maps.LatLng(coords[i + 1][1], coords[i + 1][0]));
        }
        completedPath.push(new google.maps.LatLng(snapped.geometry.coordinates[1], snapped.geometry.coordinates[0]));
        incompletePath.push(new google.maps.LatLng(snapped.geometry.coordinates[1], snapped.geometry.coordinates[0]));

        for (i = closestSegmentIndex; i < coords.length - 1; i++) {
            incompletePath.push(new google.maps.LatLng(coords[i + 1][1], coords[i + 1][0]))
        }

        // Create paths
        newPaths = [
            new google.maps.Polyline({
                path: completedPath,
                geodesic: true,
                strokeColor: '#00ff00',
                strokeOpacity: 1.0,
                strokeWeight: 2
            }),
            new google.maps.Polyline({
                path: incompletePath,
                geodesic: true,
                strokeColor: '#ff0000',
                strokeOpacity: 1.0,
                strokeWeight: 2
            })
        ];

        return newPaths;
    }


    function getAuditTaskId () {
        return properties.auditTaskId;
    }

    /**
     * Get a geojson feature
     * @returns {null}
     */
    function getFeature () {
        return _geojson ? _geojson.features[0] : null;
    }

    /**
     * Get geojson
     * @returns {*}
     */
    function getGeoJSON () { 
        return _geojson; 
    }

    /**
     * Get geometry
     */
    function getGeometry () {
        return _geojson ? _geojson.features[0].geometry : null;
    }

    /**
     * Get the last coordinate in the geojson.
     * @returns {{lat: *, lng: *}}
     */
    function getLastCoordinate () {
        var len = geojson.features[0].geometry.coordinates.length - 1,
            lat = _geojson.features[0].geometry.coordinates[len][1],
            lng = _geojson.features[0].geometry.coordinates[len][0];
        return { lat: lat, lng: lng };
    }

    /**
     * Return the property
     * @param key Field name
     * @returns {null}
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Get the first coordinate in the geojson
     * @returns {{lat: *, lng: *}}
     */
    function getStartCoordinate () {
        var lat = _geojson.features[0].geometry.coordinates[0][1],
            lng = _geojson.features[0].geometry.coordinates[0][0];
        return { lat: lat, lng: lng };
    }

    /**
     * Returns the street edge id of the current task.
     */
    function getStreetEdgeId () {
        return _geojson.features[0].properties.street_edge_id;
    }


    /**
     * References:
     * http://turfjs.org/static/docs/module-turf_point-on-line.html
     * http://turfjs.org/static/docs/module-turf_distance.html
     */
    function getTaskCompletionRate () {
        var i,
            point,
            lineLength,
            cumsumRate,
            latlng = svl.map.getPosition(),
            line = _geojson.features[0],
            currentPoint = turf.point([latlng.lng, latlng.lat]),
            snapped = turf.pointOnLine(line, currentPoint),
            closestSegmentIndex = closestSegment(currentPoint, line),
            coords = line.geometry.coordinates,
            segment,
            cumSum = 0;
        for (i = 0; i < closestSegmentIndex; i++) {
            segment = turf.linestring([ [coords[i][0], coords[i][1]], [coords[i + 1][0], coords[i + 1][1]] ]);
            cumSum += turf.lineDistance(segment);
        }

        point = turf.point([coords[closestSegmentIndex][0], coords[closestSegmentIndex][1]]);
        cumSum += turf.distance(snapped, point);
        lineLength = turf.lineDistance(line);
        cumsumRate = cumSum / lineLength;

        return taskCompletionRate < cumsumRate ? cumsumRate : taskCompletionRate;
    }

    /**
     * Returns the task start time
     */
    function getTaskStart () {
        return _geojson.features[0].properties.task_start;
    }

    /**
     * Get the cumulative distance
     * Reference:
     * turf-line-distance: https://github.com/turf-junkyard/turf-line-distance
     *
     * @params {units} String can be degrees, radians, miles, or kilometers
     * @returns {number} distance in meters
     */
    function getDistanceWalked (units) {
        if (!units) units = "kilometers";

        var i,
            point,
            latlng = svl.map.getPosition(),
            line = _geojson.features[0],
            currentPoint = turf.point([latlng.lng, latlng.lat]),
            snapped = turf.pointOnLine(line, currentPoint),
            closestSegmentIndex = closestSegment(currentPoint, line),
            coords = line.geometry.coordinates,
            segment,
            distance = 0;
        for (i = 0; i < closestSegmentIndex; i++) {
            segment = turf.linestring([[coords[i][0], coords[i][1]], [coords[i + 1][0], coords[i + 1][1]]]);
            distance += turf.lineDistance(segment);
        }

        // Check if the snapped point is not too far away from the current point. Then add the distance between the
        // snapped point and the last segment point to cumSum.
        if (turf.distance(snapped, currentPoint, units) < 100) {
            point = turf.point([coords[closestSegmentIndex][0], coords[closestSegmentIndex][1]]);
            distance += turf.distance(snapped, point);
        }

        return distance;
    }


    /**
     * This method checks if the task is completed by comparing the
     * current position and the ending point.
     * 
     * @param lat
     * @param lng
     * @param threshold
     * @returns {boolean}
     */
    function isAtEnd (lat, lng, threshold) {
        if (_geojson) {
            var d, len = _geojson.features[0].geometry.coordinates.length - 1,
                latEnd = _geojson.features[0].geometry.coordinates[len][1],
                lngEnd = _geojson.features[0].geometry.coordinates[len][0];

            if (!threshold) threshold = 10; // 10 meters
            d = svl.util.math.haversine(lat, lng, latEnd, lngEnd);
            return d < threshold;
        }
    }

    /**
     * Returns if the task is completed or not
     * @returns {boolean}
     */
    function isCompleted () {
        return status.isCompleted;
    }

    /**
     * Checks if the current task is connected to the given task
     * @param task
     * @param threshold
     * @param unit
     * @returns {boolean}
     */
    function isConnectedTo (task, threshold, unit) {
        if (!threshold) threshold = 0.01;
        if (!unit) unit = "kilometers";

        var lastCoordinate = getLastCoordinate(),
            targetCoordinate1 = task.getStartCoordinate(),
            targetCoordinate2 = task.getLastCoordinate(),
            p = turf.point([lastCoordinate.lng, lastCoordinate.lat]),
            p1 = turf.point([targetCoordinate1.lng, targetCoordinate1.lat]),
            p2 = turf.point([targetCoordinate2.lng, targetCoordinate2.lat]);
        return turf.distance(p, p1, unit) < threshold || turf.distance(p, p2, unit) < threshold;
    }

    function isConnectedToAPoint(point, threshold, unit) {
        if (!threshold) threshold = 0.01;
        if (!unit) unit = "kilometers";

        var startCoordinate = getStartCoordinate(),
            lastCoordinate = getLastCoordinate(),
            p2 = turf.point([lastCoordinate.lng, lastCoordinate.lat]),
            p1 = turf.point([startCoordinate.lng, startCoordinate.lat]);
        return turf.distance(point, p1, unit) < threshold || turf.distance(point, p2, unit) < threshold;
    }

    /**
     * Get the line distance of the task street edge
     * @param unit
     * @returns {*}
     */
    function lineDistance(unit) {
        if (!unit) unit = "kilometers";
        return turf.lineDistance(_geojson.features[0], unit);
    }

    /**
     * Get a distance between a point and a segment
     * @param point A Geojson Point feature
     * @param segment A Geojson LineString feature with two points
     * @returns {*}
     */
    function pointSegmentDistance(point, segment) {
        var snapped = turf.pointOnLine(segment, point),
            snappedLat = snapped.geometry.coordinates[1],
            snappedLng = snapped.geometry.coordinates[0],
            coords = segment.geometry.coordinates;
        if (Math.min(coords[0][0], coords[1][0]) <= snappedLng &&
            snappedLng <= Math.max(coords[0][0], coords[1][0]) &&
            Math.min(coords[0][1], coords[1][1]) <= snappedLat &&
            snappedLng <= Math.max(coords[0][1], coords[1][1])) {
            return turf.distance(point, snapped);
        } else {
            var point1 = turf.point([coords[0][0], coords[0][1]]);
            var point2 = turf.point([coords[1][0], coords[1][1]]);
            return Math.min(turf.distance(point, point1), turf.distance(point, point2));
        }
    }

    /**
     * Render the task path on the Google Maps pane.
     * Todo. This should be Map.js's responsibility.
     * Reference:
     * https://developers.google.com/maps/documentation/javascript/shapes#polyline_add
     * https://developers.google.com/maps/documentation/javascript/examples/polyline-remove
     */
    function render () {
        if ('map' in svl && google) {
            if (paths) {
                // Remove the existing paths and switch with the new ones
                for (var i = 0; i < paths.length; i++) {
                    paths[i].setMap(null);
                }

                var newTaskCompletionRate = getTaskCompletionRate();

                if (taskCompletionRate < newTaskCompletionRate) {
                    taskCompletionRate = newTaskCompletionRate;
                    paths = completedTaskPaths();
                }
            } else {
                var gCoordinates = _geojson.features[0].geometry.coordinates.map(function (coord) {
                    return new google.maps.LatLng(coord[1], coord[0]);
                });
                paths = [
                    new google.maps.Polyline({
                        path: gCoordinates,
                        geodesic: true,
                        strokeColor: '#ff0000',
                        strokeOpacity: 1.0,
                        strokeWeight: 2
                    })
                ];
            }

            for (i = 0; i < previousPaths.length; i++) {
                previousPaths[i].setMap(svl.map.getMap());
            }
            for (i = 0; i < paths.length; i++) {
                paths[i].setMap(svl.map.getMap());
            }
        }
    }

    /**
     * Flip the coordinates of the line string if the last point is closer to the end point of the current street segment.
     */
    function reverseCoordinates () {
        _geojson.features[0].geometry.coordinates.reverse();
    }

    function setProperty (key, value) {
        properties[key] = value;
    }

    _init (geojson, currentLat, currentLng);

    self.complete = complete;
    self.getAuditTaskId = getAuditTaskId;
    self.getProperty = getProperty;
    self.getDistanceWalked = getDistanceWalked;
    self.getFeature = getFeature;
    self.getGeoJSON = getGeoJSON;
    self.getGeometry = getGeometry;
    self.getLastCoordinate = getLastCoordinate;
    self.getStartCoordinate = getStartCoordinate;
    self.getStreetEdgeId = getStreetEdgeId;
    self.getTaskStart = getTaskStart;
    self.getTaskCompletionRate = function () {
        return taskCompletionRate ? taskCompletionRate : 0;
    };
    self.initialLocation = getStartCoordinate;
    self.isAtEnd = isAtEnd;
    self.isCompleted = isCompleted;
    self.isConnectedTo = isConnectedTo;
    self.isConnectedToAPoint = isConnectedToAPoint;
    self.lineDistance = lineDistance;
    self.render = render;
    self.reverseCoordinates = reverseCoordinates;
    self.setProperty = setProperty;

    return self;
}
/**
 * TaskContainer module.
 * @param turf
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function TaskContainer (turf) {
    var self = { className: "TaskContainer" },
        previousTasks = [],
        currentTask = null,
        paths, previousPaths = [],
        taskStoreByRegionId = {};

    /**
     * I had to make this method to wrap the street view service.
     * @param task
     */
    function initNextTask (task) {
        var nextTask = svl.taskContainer.nextTask(task),
            geometry,
            lat,
            lng;
        geometry = nextTask.getGeometry();
        lat = geometry.coordinates[0][1];
        lng = geometry.coordinates[0][0];

        // var streetViewService = new google.maps.StreetViewService();
        var STREETVIEW_MAX_DISTANCE = 25;
        var latLng = new google.maps.LatLng(lat, lng);

        svl.streetViewService.getPanoramaByLocation(latLng, STREETVIEW_MAX_DISTANCE, function (streetViewPanoramaData, status) {
            if (status === google.maps.StreetViewStatus.OK) {
                svl.taskContainer.setCurrentTask(nextTask);
                svl.map.setPosition(streetViewPanoramaData.location.latLng.lat(), streetViewPanoramaData.location.latLng.lng());
            } else if (status === google.maps.StreetViewStatus.ZERO_RESULTS) {
                // no street view available in this range.
                svl.taskContainer.initNextTask();
            } else {
                throw "Error loading Street View imagey.";
            }
        });
    }

    /**
     * End the current task.
     */
    function endTask (task) {
        if ('tracker' in svl) svl.tracker.push("TaskEnd");
        var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
        task.complete();

        // Update the total distance across neighborhoods that the user has audited
        updateAuditedDistance("miles");

        if (!('user' in svl) || (svl.user.getProperty('username') == "anonymous" && getCompletedTaskDistance(neighborhood.getProperty("regionId"), "kilometers") > 0.15)) {
            if (!svl.popUpMessage.haveAskedToSignIn()) svl.popUpMessage.promptSignIn();
        } else {
            // Submit the data.
            var data = svl.form.compileSubmissionData(task),
                staged = svl.storage.get("staged");

            if (staged.length > 0) {
                staged.push(data);
                svl.form.submit(staged, task);
                svl.storage.set("staged", []);  // Empty the staged data.
            } else {
                svl.form.submit(data, task);
            }
        }

        push(task); // Push the data into previousTasks

        // Clear the current paths
        var _geojson = task.getGeoJSON(),
            gCoordinates = _geojson.features[0].geometry.coordinates.map(function (coord) { return new google.maps.LatLng(coord[1], coord[0]); });
        previousPaths.push(new google.maps.Polyline({ path: gCoordinates, geodesic: true, strokeColor: '#00ff00', strokeOpacity: 1.0, strokeWeight: 2 }));
        paths = null;

        return task;
    }


    /**
     * Fetch a task based on the street id.
     * @param regionId
     * @param streetEdgeId
     * @param callback
     * @param async
     */
    function fetchATask(regionId, streetEdgeId, callback, async) {
        if (typeof async == "undefined") async = true;
        $.ajax({
            url: "/task/street/" + streetEdgeId,
            type: 'get',
            success: function (json) {
                var lat1 = json.features[0].geometry.coordinates[0][1],
                    lng1 = json.features[0].geometry.coordinates[0][0],
                    newTask = svl.taskFactory.create(json, lat1, lng1);
                if (json.features[0].properties.completed) newTask.complete();
                storeTask(regionId, newTask);
                if (callback) callback();
            },
            error: function (result) {
                throw result;
            }
        });
    }

    /**
     * Request the server to populate tasks
     * @param regionId {number} Region id
     * @param callback A callback function
     * @param async {boolean}
     */
    function fetchTasksInARegion(regionId, callback, async) {
        if (typeof async == "undefined") async = true;

        if (typeof regionId == "number") {
            $.ajax({
                url: "/tasks?regionId=" + regionId,
                async: async,
                type: 'get',
                success: function (result) {
                    var task;
                    for (var i = 0; i < result.length; i++) {
                        task = svl.taskFactory.create(result[i]);
                        if ((result[i].features[0].properties.completed)) task.complete();
                        storeTask(regionId, task);
                    }

                    if (callback) callback();
                },
                error: function (result) {
                    console.error(result);
                }
            });
        } else {
            console.error("regionId should be an integer value");
        }
    }

    /**
     * Find tasks (i.e., street edges) in the region that are connected to the given task.
     * @param regionId {number} Region id
     * @param taskIn {object} Task
     * @param threshold {number} Distance threshold
     * @param unit {string} Distance unit
     * @returns {Array}
     */
    function findConnectedTask (regionId, taskIn, threshold, unit) {
        var i,
            len,
            tasks = getTasksInRegion(regionId),
            connectedTasks = [];

        if (!threshold) threshold = 0.01;  // 0.01 km.
        if (!unit) unit = "kilometers";
        tasks = tasks.filter(function (t) { return !t.isCompleted(); });

        if (taskIn) {
            tasks = tasks.filter(function (t) { return t.getStreetEdgeId() != taskIn.getStreetEdgeId(); });  // Filter out the current task
            len = tasks.length;

            for (i = 0; i < len; i++) {
                if (taskIn.isConnectedTo(tasks[i], threshold, unit)) {
                    connectedTasks.push(tasks[i]);
                }
            }
            return connectedTasks;
        } else {
            return tasks;
        }

    }

    /**
     * Get the total distance of completed segments
     * @params {unit} String can be degrees, radians, miles, or kilometers
     * @returns {number} distance in meters
     */
    function getCompletedTaskDistance (regionId, unit) {
        if (!unit) unit = "kilometers";

        var completedTasks = getCompletedTasks(regionId),
            geojson,
            feature,
            i,
            len,
            distance = 0;

        if (completedTasks) {
            len = completedTasks.length;
            for (i = 0; i < len; i++) {
                geojson = completedTasks[i].getGeoJSON();
                feature = geojson.features[0];
                distance += turf.lineDistance(feature, unit);
            }

            if (currentTask) distance += currentTask.getDistanceWalked(unit);

            return distance;
        } else {
            return 0;
        }
    }

    /**
     * This method returns the completed tasks in the given region
     * @param regionId
     * @returns {Array}
     */
    function getCompletedTasks (regionId) {
        if (!(regionId in taskStoreByRegionId)) {
            console.error("getCompletedTasks needs regionId");
            return null;
        }
        if (!Array.isArray(taskStoreByRegionId[regionId])) {
            console.error("taskStoreByRegionId[regionId] is not an array. Probably the data from this region is not loaded yet.");
            return null;
        }
        return taskStoreByRegionId[regionId].filter(function (task) {
            return task.isCompleted();
        });
    }

    /**
     * Get the current task
     * @returns {*}
     */
    function getCurrentTask () {
        return currentTask;
    }

    function getIncompleteTasks (regionId) {
        if (!regionId && regionId !== 0) {
            console.error("regionId is not specified")
        }
        if (!(regionId in taskStoreByRegionId)) {
            console.error("regionId is not in taskStoreByRegionId. This is probably because you have not fetched the tasks in the region yet (e.g., by fetchTasksInARegion)");
            return null;
        }
        if (!Array.isArray(taskStoreByRegionId[regionId])) {
            console.error("taskStoreByRegionId[regionId] is not an array. Probably the data from this region is not loaded yet.");
            return null;
        }
        return taskStoreByRegionId[regionId].filter(function (task) {
            return !task.isCompleted();
        });
    }

    function getTasksInRegion (regionId) {
        return regionId in taskStoreByRegionId ? taskStoreByRegionId[regionId] : null;
    }

    /**
     * Check if the current task is the first task in this session
     * @returns {boolean}
     */
    function isFirstTask () {
        return length() == 0;
    }

    /**
     * Get the length of the previous tasks
     * @returns {*|Number}
     */
    function length () {
        return previousTasks.length;
    }

    /**
     * Get the next task and set it as a current task.
     * @param task Current task
     * @returns {*} Next task
     */
    function nextTask (task) {
        var newTask = null,
            neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood(),
            candidateTasks = findConnectedTask(neighborhood.getProperty("regionId"), task, null, null);

        candidateTasks = candidateTasks.filter(function (t) { return !t.isCompleted(); });

        if (candidateTasks.length > 0) {
            newTask = candidateTasks[0];
        } else {
            candidateTasks = getIncompleteTasks(neighborhood.getProperty("regionId"));
            newTask = candidateTasks[0];
        }

        if (task) {
            var c1 = task.getLastCoordinate(),
                c2 = newTask.getStartCoordinate(),
                p1 = turf.point([c1.lng, c1.lat]),
                p2 = turf.point([c2.lng, c2.lat]);
            if (turf.distance(p1, p2, "kilometers") > 0.025) {
                newTask.reverseCoordinates();
            }
        }

        return newTask;
    }

    /**
     * Push a task to previousTasks
     * @param task
     */
    function push (task) {
        // Todo. Check for the duplicates.
        previousTasks.push(task);
    }

    /**
     * Set the current task
     * @param task
     */
    function setCurrentTask (task) {
        currentTask = task;
        if ("tracker" in svl) {
            svl.tracker.push('TaskStart');
        }

        if ('compass' in svl) {
            svl.compass.setTurnMessage();
            svl.compass.showMessage();
            svl.compass.update();
        }
    }

    /**
     * Store a task into taskStoreByRegionId
     * @param regionId {number} Region id
     * @param task {object} Task object
     */
    function storeTask(regionId, task) {
        if (!(regionId in taskStoreByRegionId)) taskStoreByRegionId[regionId] = [];
        var streetEdgeIds = taskStoreByRegionId[regionId].map(function (task) {
            return task.getProperty("streetEdgeId");
        });
        if (streetEdgeIds.indexOf(task.street_edge_id) < 0) taskStoreByRegionId[regionId].push(task);  // Check for duplicates
    }

    /**
     *
     * @param regionId
     */
    function totalLineDistanceInARegion(regionId, unit) {
        if (!unit) unit = "kilometers";
        var tasks = getTasksInRegion(regionId);

        if (tasks) {
            var distanceArray = tasks.map(function (t) { return t.lineDistance(unit); });
            return distanceArray.sum();
        } else {
            return null;
        }
    }

    /**
     * This method is called from Map.handlerPositionUpdate() to update the color of audited and unaudited street
     * segments on Google Maps.
     * KH: It maybe more natural to let a method in Map.js do handle it...
     */
    function update () {
        var i, len = previousTasks.length;
        for (i = 0; i < len; i++) previousTasks[i].render();
        currentTask.render();
    }

    /**
     * Update the audited distance by combining the distance previously traveled and the distance the user traveled in
     * the current session.
     * Todo. Fix this. The function name should be clear that this updates the global distance rather than the distance traveled in the current neighborhood. Also get rid of the async call.
     * @returns {updateAuditedDistance}
     */
    function updateAuditedDistance (unit) {
        if (!unit) unit = "kilometers";
        var distance = 0,
            sessionDistance = 0,
            neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();

        if (neighborhood) {
            sessionDistance = getCompletedTaskDistance(neighborhood.getProperty("regionId"), unit);
        }

        distance += sessionDistance;
        svl.ui.progress.auditedDistance.html(distance.toFixed(2));
        return this;
    }

    self.initNextTask = initNextTask;
    self.endTask = endTask;
    self.fetchATask = fetchATask;
    self.fetchTasksInARegion = fetchTasksInARegion;
    self.findConnectedTask = findConnectedTask;
    self.getCompletedTasks = getCompletedTasks;
    self.getCompletedTaskDistance = getCompletedTaskDistance;
    self.getCurrentTask = getCurrentTask;
    self.getIncompleteTasks = getIncompleteTasks;
    self.getTasksInRegion = getTasksInRegion;
    self.isFirstTask = isFirstTask;
    self.length = length;
    self.nextTask = nextTask;
    self.push = push;

    self.setCurrentTask = setCurrentTask;
    self.storeTask = storeTask;
    self.totalLineDistanceInARegion = totalLineDistanceInARegion;
    self.update = update;
    self.updateAuditedDistance = updateAuditedDistance;

    return self;
}
/**
 * TaskFactory module.
 * @param turf
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function TaskFactory (turf) {
    var self = { className: "TaskFactory" };

    /**
     * Create a new task instance
     * @param geojson
     * @param lat
     * @param lng
     * @returns {svl.Task}
     */
    function create(geojson, lat, lng) {
        return new Task(turf, geojson, lat, lng);
    }
    
    self.create = create;

    return self;
}
/**
 * Mission module
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Mission(parameters) {
    var self = { className: "Mission" },
        properties = {
            regionId: null,
            label: null,
            missionId: null,
            level: null,
            isCompleted: false,
            instruction: null,
            completionMessage: null,
            badgeURL: null,
            distance: null,
            distanceFt: null,
            distanceMi: null,
            coverage: null
        },
        _tasksForTheMission = [],
        labelCountsAtCompletion;
    
    function _init(parameters) {
        if ("regionId" in parameters) setProperty("regionId", parameters.regionId);
        if ("missionId" in parameters) setProperty("missionId", parameters.missionId);
        if ("level" in parameters) setProperty("level", parameters.level);
        if ("distance" in parameters) setProperty("distance", parameters.distance);
        if ("distanceFt" in parameters) setProperty("distanceFt", parameters.distanceFt);
        if ("distanceMi" in parameters) setProperty("distanceMi", parameters.distanceMi);
        if ("coverage" in parameters) setProperty("coverage", parameters.coverage);
        if ("isCompleted" in parameters) setProperty("isCompleted", parameters.isCompleted);

        if ("label" in parameters) {
            var instruction, completionMessage, badgeURL;
            setProperty("label", parameters.label);
            self.label = parameters.label;  // For debugging. You don't actually need this.
            self.distance = parameters.distance;  // For debugging. You don't actually need this.

            if (parameters.label == "initial-mission") {
                instruction = "Your goal is to <span class='bold'>audit 1000 feet of the streets in this neighborhood and find the accessibility attributes!";
                completionMessage = "Good job! You have completed the first mission. Keep making the city more accessible!";
                badgeURL = svl.rootDirectory + "/img/misc/BadgeInitialMission.png";
            } else if (parameters.label == "distance-mission") {
                var distance = parameters.distance;
                var distanceString = imperialDistance();

                instruction = "Your goal is to <span class='bold'>audit " + distanceString + " of the streets in this neighborhood and find the accessibility attributes!";
                completionMessage = "Good job! You have successfully made " + distanceString + " of this neighborhood accessible.";

                if (distance == 500) {
                    // 2000 ft
                    badgeURL = svl.rootDirectory + "/img/misc/Badge_500.png";
                } else if (distance == 1000) {
                    // 4000 ft
                    badgeURL = svl.rootDirectory + "/img/misc/Badge_1000.png";
                } else {
                    // miles
                    var level = "level" in parameters ? parameters.level : 1;
                    level = (level - 1) % 5 + 1;
                    badgeURL = svl.rootDirectory + "/img/misc/Badge_Level" + level + ".png";
                }
            } else if (parameters.label == "area-coverage-mission") {
                var coverage = parameters.coverage, coverageString = coverage + "%";
                instruction = "Your goal is to <span class='bold'>audit " + coverageString + " of the streets in this neighborhood and find the accessibility attributes!";
                completionMessage = "Good job! You have successfully made " + coverageString + " of this neighborhood accessible.";
                badgeURL = svl.rootDirectory + "/img/misc/Badge" + coverage + "Percent.png";
            } else if (parameters.label == "onboarding") {

            } else {
                console.error("It shouldn't reach here.");
            }
            setProperty("instruction", instruction);
            setProperty("completionMessage", completionMessage);
            setProperty("badgeURL", badgeURL);
        }
    }

    /**
     * Because the imperial metric system is messed up.
     * @returns {string}
     */
    function imperialDistance () {
        var distance = getProperty("distance");
        if (distance) {
            if (distance < 1500) {
                if (distance == 250) {
                    return "1000 feet";
                } else if (distance == 500) {
                    return "2000 feet";
                } else if (distance == 1000) {
                    return "4000 feet";
                } else {
                    return distance * 3;
                }
            } else {
                var miles = distance % 1500;
                return miles + "miles";
            }
        } else {
            console.error("Distance is null");
        }
    }

    /**
     * Set the property to complete
     */
    function complete () {
        // Play the animation and audio effect after task completion.
        svl.ui.task.taskCompletionMessage.css('visibility', 'visible').hide();
        svl.ui.task.taskCompletionMessage.removeClass('animated bounce bounceOut').fadeIn(300).addClass('animated bounce');
        setTimeout(function () { svl.ui.task.taskCompletionMessage.fadeOut(300).addClass('bounceOut'); }, 1000);

        if ('audioEffect' in svl) {
            svl.audioEffect.play('yay');
            svl.audioEffect.play('applause');
        }

        // Reset the label counter
        if ('labelCounter' in svl) {
            labelCountsAtCompletion = {
                "CurbRamp": svl.labelCounter.countLabel("CurbRamp"),
                "NoCurbRamp": svl.labelCounter.countLabel("NoCurbRamp"),
                "Obstacle": svl.labelCounter.countLabel("Obstacle"),
                "SurfaceProblem": svl.labelCounter.countLabel("SurfaceProblem"),
                "Other": svl.labelCounter.countLabel("Other")
            };
            svl.labelCounter.reset();
        }
        
        setProperty("isCompleted", true);
    }

    /**
     * Total line distance of the completed tasks in this mission
     * @param unit
     */
    function completedLineDistance (unit) {
        if (!unit) unit = "kilometers";
        var completedTasks = _tasksForTheMission.filter(function (t) { return t.isCompleted(); });
        var distances = completedTasks.map(function (t) { return t.lineDistance(unit); });
        return distances.sum();
    }

    /**
     *
     * @param currentTask
     * @param unit
     * @returns {*}
     */
    function computeRoute (currentTask, unit) {
        if ("taskContainer" in svl && svl.taskContainer && "neighborhoodContainer" in svl && svl.neighborhoodContainer) {
            if (!unit) unit = "kilometers";
            var tmpDistance  = currentTask.lineDistance(unit);
            var tasksInARoute = [currentTask];
            var targetDistance = properties.distance / 1000;
            var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood(); // Todo. Pass this as a parameter
            var incompleteTasks = svl.taskContainer.getIncompleteTasks(neighborhood.getProperty("regionId"));
            var connectedTasks;
            var currentTaskIndex;
            var lastCoordinate;
            var lastPoint;

            if (targetDistance < tmpDistance && incompleteTasks.length == 0) {
                return tasksInARoute;
            }

            // Check if there are any street edges connected to the last coordinate of currentTask's street edge.
            lastCoordinate = currentTask.getLastCoordinate();
            lastPoint = turf.point([lastCoordinate.lng, lastCoordinate.lat]);
            connectedTasks = incompleteTasks.filter(function (t) { return t.isConnectedToAPoint(lastPoint) && tasksInARoute.indexOf(t) < 0});
            if (connectedTasks.length == 0) {
                // Reverse the coordinates in the currentTask's street edge if there are no street edges connected to the current last coordinate
                currentTask.reverseCoordinates();
                lastCoordinate = currentTask.getLastCoordinate();
                lastPoint = turf.point([lastCoordinate.lng, lastCoordinate.lat]);
                connectedTasks = incompleteTasks.filter(function (t) { return t.isConnectedToAPoint(lastPoint) && tasksInARoute.indexOf(t) < 0});
            }

            // Compute a route
            while (targetDistance > tmpDistance && incompleteTasks.length > 0) {
                lastCoordinate = currentTask.getLastCoordinate();
                lastPoint = turf.point([lastCoordinate.lng, lastCoordinate.lat]);
                connectedTasks = incompleteTasks.filter(function (t) { return t.isConnectedToAPoint(lastPoint) && tasksInARoute.indexOf(t) < 0});

                if (connectedTasks.length > 0) {
                    connectedTasks = svl.util.shuffle(connectedTasks);
                    currentTask = connectedTasks[0];
                } else {
                    incompleteTasks = svl.util.shuffle(incompleteTasks);  // Shuffle the incommplete tasks
                    currentTask = incompleteTasks[0];  // get the first item in the array
                }
                currentTaskIndex = incompleteTasks.indexOf(currentTask);
                incompleteTasks.splice(currentTaskIndex, 1);  // Remove the current task from the incomplete tasks

                tasksInARoute.push(currentTask);
                tmpDistance +=  currentTask.lineDistance(unit);
            }
            return tasksInARoute;
        } else {
            return null;
        }
    }

    /**
     * This method returns the label count object
     * @returns {*}
     */
    function getLabelCount () {
        return labelCountsAtCompletion;
    }

    /**
     * Compute and return the mission completion rate
     * @returns {number}
     */
    function getMissionCompletionRate (unit) {
        if (!unit) unit = "kilometers";
        if ("taskContainer" in svl) {
            var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
            var targetDistance = getProperty("distance") / 1000;  // Convert meters to kilometers
            var initialMission = svl.missionContainer.getMission(null, "initial-mission", 1);
            var missions = svl.missionContainer.getMissionsByRegionId(neighborhood.getProperty("regionId"));
            missions = missions.filter(function (m) { return m.isCompleted() && m != this; });  // Get the completed missions

            // Get the last completed mission's target distance
            var distanceAuditedSoFar = missions.length > 0 ? missions[missions.length - 1].getProperty("distance") / 1000 : 0;
            if (distanceAuditedSoFar === 0 && initialMission.isCompleted()) {
                distanceAuditedSoFar = initialMission.getProperty("distance") / 1000;
            }

            var completedDistance = svl.taskContainer.getCompletedTaskDistance(neighborhood.getProperty("regionId"), unit);

            return Math.max(0, completedDistance - distanceAuditedSoFar) / (targetDistance - distanceAuditedSoFar);
        } else {
            return 0;
        }
    }

    /** Returns a property */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Get an array of tasks for this mission
     * @returns {Array}
     */
    function getRoute () {
        return _tasksForTheMission;
    }

    /**
     * Check if the mission is completed or not
     * Todo. Shouldn't it be isComplete rather than isCompleted???
     *
     * @returns {boolean}
     */
    function isCompleted () {
        return getProperty("isCompleted");
    }

    /**
     * Sets a property
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Set a route
     * @param tasksInARoute An array of tasks
     */
    function setRoute (tasksInARoute) {
        _tasksForTheMission = tasksInARoute;
    }

    /** Compute the remaining audit distance till complete (in meters) */
    function remainingAuditDistanceTillComplete () {
        var label = getProperty("label");
        if (label) {
            var distance, cumulativeDistanceAudited = 0;  // Todo.
            if (label == "initial-mission") {
                distance = getProperty("level") * 1000;
                return distance - cumulativeDistanceAudited;
            } else if (label == "distance-mission") {
                distance = getProperty("level") * 1000;
                return distance - cumulativeDistanceAudited;
            } else if (label == "area-coverage-mission") {
                return Infinity;
            } else if (label == "neighborhood-coverage-mission") {
                return Infinity;  // Return infinity as this mission does not depend on distance traveled.
            } else {
                return Infinity;  // This should not happen...
            }
        } else {
            return Infinity;  // The label is not specified.
        }
    }

    /**
     * Return a string describing this data
     * @returns {string}
     */
    function toString () {
        return "Mission: " + getProperty("label") + ", Level: "+ getProperty("level") +
            ", Distance: " + getProperty("distance") + ", Coverage " + getProperty("coverage") +
            ", Mission Id: " + getProperty("missionId") + ", Region Id: " + getProperty("regionId") +
            ", Completed: " + getProperty("isCompleted") + "\n";
    }

    /**
     * Return an object that is in a submittable format
     * @returns {{region_id: *, label: *, mission_id: *, level: *, distance: *, coverage: *}}
     */
    function toSubmissionFormat () {
        return {
            region_id: getProperty("regionId"),
            label: getProperty("label"),
            mission_id: getProperty("missionId"),
            level: getProperty("level"),
            distance: getProperty("distance"),
            coverage: getProperty("coverage"),
            deleted: false
        };
    }

    /**
     * Total line distance in this mission.
     * @param unit
     */
    function totalLineDistance (unit) {
        var distances = _tasksForTheMission.map(function (task) { return task.lineDistance(unit); });
        return distances.sum();
    }

    _init(parameters);

    self.complete = complete;
    self.completedLineDistance = completedLineDistance;
    self.computeRoute = computeRoute;
    self.getLabelCount = getLabelCount;
    self.getProperty = getProperty;
    self.getRoute = getRoute;
    self.getMissionCompletionRate = getMissionCompletionRate;
    self.imperialDistance = imperialDistance;
    self.isCompleted = isCompleted;
    self.remainingAuditDistanceTillComplete = remainingAuditDistanceTillComplete;
    self.setProperty = setProperty;
    self.setRoute = setRoute;
    self.toString = toString;
    self.toSubmissionFormat = toSubmissionFormat;
    self.totalLineDistance = totalLineDistance;

    return self;
}
/**
 * MissionContainer module
 * @param $ jQuery object
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionContainer ($, parameters) {
    var self = { className: "MissionContainer" },
        missionStoreByRegionId = { "noRegionId" : []},
        completedMissions = [],
        staged = [],
        currentMission = null;

    function _init (parameters) {
        parameters = parameters || {};
        // Query all the completed & incomplete missions.
        function _callback (result1, result2) {
            var i, len, mission, completed = result1[0], incomplete = result2[0], nm;

            len = completed.length;
            for (i = 0; i < len; i++) {
                mission = svl.missionFactory.create(completed[i].regionId, completed[i].missionId, completed[i].label,
                    completed[i].level, completed[i].distance, completed[i].distance_ft, completed[i].distance_mi, completed[i].coverage, true);
                addAMission(completed[i].regionId, mission);
                addToCompletedMissions(mission);
            }

            len = incomplete.length;
            for (i = 0; i < len; i++) {
                mission = svl.missionFactory.create(incomplete[i].regionId, incomplete[i].missionId, incomplete[i].label,
                    incomplete[i].level, incomplete[i].distance, incomplete[i].distance_ft, incomplete[i].distance_mi, incomplete[i].coverage, false);
                addAMission(incomplete[i].regionId, mission);
            }

            // Set the current mission.
            if (parameters.currentNeighborhood) {
                nm = nextMission(parameters.currentNeighborhood.getProperty("regionId"));
                setCurrentMission(nm);
            }
        }
        
        if ("callback" in parameters) {
            $.when($.ajax("/mission/complete"), $.ajax("/mission/incomplete")).done(_callback).done(parameters.callback);
        } else {
            $.when($.ajax("/mission/complete"), $.ajax("/mission/incomplete")).done(_callback)
        }
    }

    /**
     * Adds a mission into data structure.
     * @param regionId
     * @param mission
     */
    function addAMission(regionId, mission) {
        if (regionId || regionId === 0) {
            if (!(regionId in missionStoreByRegionId)) missionStoreByRegionId[regionId] = [];
        } else {
            regionId = "noRegionId";
        }

        var m = getMission(mission.getProperty("regionId"), mission.getProperty("label"), mission.getProperty("level"));
        if (!m) {
            missionStoreByRegionId[regionId].push(mission);
        }
    }

    /** Push the completed mission */
    function addToCompletedMissions (mission) {
        completedMissions.push(mission);

        if ("regionId" in mission) {
            // Add the region id to missionStoreByRegionId if it's not there already
            if (!getMissionsByRegionId(mission.regionId)) missionStoreByRegionId[mission.regionId] = [];

            // Add the mission into missionStoreByRegionId if it's not there already
            var missionIds = missionStoreByRegionId[mission.regionId].map(function (x) { return x.missionId; });
            if (missionIds.indexOf(mission.missionId) < 0) missionStoreByRegionId[regionId].push(mission);
        }
    }

    /**
     * Submit the currently staged missions to the server.
     * Todo. I no longer have to stage-and-commit... So I can simplify this.
     * @returns {commit}
     */
    function commit () {
        if (staged.length > 0) {
            var i, data = [];

            for (i = 0; i < staged.length; i++) {
                data.push(staged[i].toSubmissionFormat());
            }
            staged = [];

            if ("form" in svl && svl.form) {
                svl.form.postJSON("/mission", data);
            }
        }
        return this;
    }

    /** Get current mission */
    function getCurrentMission () {
        return currentMission;
    }

    /**
     * Get a mission stored in the missionStoreByRegionId.
     * @param regionId
     * @param label
     * @param level
     * @returns {*}
     */
    function getMission(regionId, label, level) {
        if (!regionId) regionId = "noRegionId";
        var missions = missionStoreByRegionId[regionId],
            i, len = missions.length;
        for (i = 0; i < len; i++) {
            if (missions[i].getProperty("label") == label) {
                if (level) {
                    if (level == missions[i].getProperty("level")) {
                        return missions[i];
                    }
                } else {
                    return missions[i];
                }
            }
        }
        return null;
    }
    
    /**
     * Get all the completed missions
     */
    function getCompletedMissions () {
        return completedMissions;
    }

    /**
     * Get all the completed missions with the given region id
     *
     * @param regionId A region id
     * @returns {*}
     */
    function getMissionsByRegionId (regionId) {
        if (!(regionId in missionStoreByRegionId)) missionStoreByRegionId[regionId] = [];
        var missions = missionStoreByRegionId[regionId];
        missions.sort(function(m1, m2) {
            var d1 = m1.getProperty("distance"),
                d2 = m2.getProperty("distance");
            if (!d1) d1 = 0;
            if (!d2) d2 = 0;
            return d1 - d2;
        });
        return missions;
    }

    function nextMission (regionId) {
        var missions = getMissionsByRegionId (regionId);
        missions = missions.filter(function (m) { return !m.isCompleted(); });

        if (missions.length > 0) {
            missions.sort(function (m1, m2) {
                var d1 = m1.getProperty("distance"), d2 = m2.getProperty("distance");
                if (d1 == d2) return 0;
                else if (d1 < d2) return -1;
                else return 1;
            });
            return missions[0];
        } else {
            return null;
        }
    }

    /**
     *
     */
    function refresh () {
        missionStoreByRegionId = { "noRegionId" : [] };
        completedMissions = [];
        staged = [];
        currentMission = null;
    }

    /**
     * This method sets the current mission
     * @param mission {object} A Mission object
     * @returns {setCurrentMission}
     */
    function setCurrentMission (mission) {
        currentMission = mission;

        if ("missionProgress" in svl && "missionStatus" in svl) {
            svl.missionProgress.update();
            svl.missionStatus.printMissionMessage(mission);
        }
        return this;
    }

    /**
     * Push the completed mission to the staged so it will be submitted to the server.
     * Todo. I no longer have to stage-and-commit... So I can simplify this.
     * @param mission
     */
    function stage (mission) {
        staged.push(mission);
        return this;
    }

    _init(parameters);

    self.addToCompletedMissions = addToCompletedMissions;
    self.add = addAMission;
    self.commit = commit;
    self.getCompletedMissions = getCompletedMissions;
    self.getCurrentMission = getCurrentMission;
    self.getMission = getMission;
    self.getMissionsByRegionId = getMissionsByRegionId;
    self.nextMission = nextMission;
    self.refresh = refresh;
    self.stage = stage;
    self.setCurrentMission = setCurrentMission;
    return self;
}
/**
 * MissionFactory module
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionFactory () {
    var self = { className: "MissionFactory" };

    /**
     * Create an instance of a mission object
     * @param regionId
     * @param missionId
     * @param label The label of the mission
     * @param level The level of the mission
     * @param distance Mission distance in meters
     * @param distanceFt Mission distance in feet
     * @param distanceMi Mission distance in miles
     * @param coverage Mission coverage rate
     * @param isCompleted A flag indicating if this mission is completed
     * @returns {svl.Mission}
     */
    function create (regionId, missionId, label, level, distance, distanceFt, distanceMi, coverage, isCompleted) {
        return new Mission({ regionId: regionId, missionId: missionId, label: label, level: level, distance: distance,
            distanceFt: distanceFt, distanceMi: distanceMi, coverage: coverage, isCompleted: isCompleted });
    }

    /**
     * Create the onboarding mission
     * @param level The level of the mission
     * @param isCompleted {boolean} A flag indicating if this mission is completed
     * @returns {svl.Mission}
     */
    function createOnboardingMission(level, isCompleted) {
        return new Mission({label: "onboarding", level: level, isCompleted: isCompleted});
    }

    self.create = create;
    self.createOnboardingMission = createOnboardingMission;
    return self;
}
/**
 * MissionProgress module.
 * Todo. Rename this... Probably some of these features should be moved to status/MissionStatus.js
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function MissionProgress () {
    var self = { className: 'MissionProgress' };
    var status = {
            currentCompletionRate: 0,
            currentMission: null,
            previousHeading: 0
        };

    function _init() {
    }

    /**
     * Finish the mission.
     * @param mission
     */
    function complete (mission) {
        if (mission) {
            mission.complete();
            svl.missionContainer.addToCompletedMissions(mission);
            svl.missionContainer.stage(mission);
        }
    }

    /**
     * @param mission Next mission
     */
    function showNextMission (mission) {
        var label = mission.getProperty("label");
        if (label == "distance-mission") {
            svl.modalMission.setMissionMessage(mission, { distance: mission.getProperty("distance"), badgeURL: mission.getProperty("badgeURL") });
        } else if (label == "area-coverage-mission") {
            svl.modalMission.setMissionMessage(mission, { coverage: mission.getProperty("coverage"), badgeURL: mission.getProperty("badgeURL") });
        } else {
            console.warn("Debug: It shouldn't reach here.");
        }
    }

    /**
     * This method updates the mission completion rate and its visualization.
     */
    function update () {
        if ("onboarding" in svl && svl.onboarding.isOnboarding()) return;  // Don't show the mission completion message
        if ("missionContainer" in svl && "neighborhoodContainer" in svl) {
            var currentRegion = svl.neighborhoodContainer.getCurrentNeighborhood(),
                currentMission = svl.missionContainer.getCurrentMission(),
                completionRate;

            var _callback = function (e) {
                var nextMission = svl.missionContainer.nextMission(currentRegion.getProperty("regionId"));
                svl.missionContainer.setCurrentMission(nextMission);
                showNextMission(nextMission);
            };

            // Update the mission completion rate in the progress bar
            if (currentMission) {
                completionRate = currentMission.getMissionCompletionRate();
                svl.missionStatus.printCompletionRate(completionRate);
                svl.missionStatus.updateMissionCompletionBar(completionRate);

                if (currentMission.getMissionCompletionRate() > 0.999) {
                    complete(currentMission);
                    svl.missionContainer.commit();

                    if ("audioEffect" in svl) {
                        svl.audioEffect.play("yay");
                        svl.audioEffect.play("applause");
                    }

                    svl.modalMissionComplete.show();
                    svl.ui.modalMissionComplete.closeButton.one("click", _callback)
                }
            }
        }
    }
    
    self.update = update;
    _init();
    return self;
}

/**
 * A Label module.
 * @param pathIn
 * @param params
 * @returns {*}
 * @constructor
 * @memberof svl
 */
function Label (pathIn, params) {
    var self = { className: 'Label' };

    var path, googleMarker;

    var properties = {
        canvasWidth: undefined,
        canvasHeight: undefined,
        canvasDistortionAlphaX: undefined,
        canvasDistortionAlphaY: undefined,
        distanceThreshold: 100,
        labelerId : 'DefaultValue',
        labelId: 'DefaultValue',
        labelType: undefined,
        labelDescription: undefined,
        labelFillStyle: undefined,
        panoId: undefined,
        panoramaLat: undefined,
        panoramaLng: undefined,
        panoramaHeading: undefined,
        panoramaPitch: undefined,
        panoramaZoom: undefined,
        photographerHeading: undefined,
        photographerPitch: undefined,
        svImageWidth: undefined,
        svImageHeight: undefined,
        svMode: undefined,
        tagHeight: 20,
        tagWidth: 1,
        tagX: -1,
        tagY: -1,
        severity: null,
        temporaryProblem: null,
        description: null
    };

    var status = {
        deleted : false,
        tagVisibility : 'visible',
        visibility : 'visible'
    };

    var lock = {
        tagVisibility: false,
        visibility : false
    };

    function _init (param, pathIn) {
        try {
            if (!pathIn) {
                throw 'The passed "path" is empty.';
            } else {
                path = pathIn;
            }

            for (var attrName in param) {
                properties[attrName] = param[attrName];
            }

            // Set belongs to of the path.
            path.setBelongsTo(self);

            if (typeof google != "undefined" && google && google.maps) {
                googleMarker = createGoogleMapsMarker(param.labelType);
                googleMarker.setMap(svl.map.getMap());
            }

            return true;
        } catch (e) {
            console.error(self.className, ':', 'Error initializing the Label object.', e);
            return false;
        }
    }

    /**
     * Blink (highlight and fade) the color of this label. If fade is true, turn the label into gray.
     * @param numberOfBlinks
     * @param fade
     * @returns {blink}
     */
    function blink (numberOfBlinks, fade) {
        if (!numberOfBlinks) {
            numberOfBlinks = 3;
        } else if (numberOfBlinks < 0) {
            numberOfBlinks = 0;
        }
        var interval;
        var highlighted = true;
        var path = getPath();
        var points = path.getPoints();

        var i;
        var len = points.length;

        var fillStyle = 'rgba(200,200,200,0.1)';
        var fillStyleHighlight = path.getFillStyle();

        interval = setInterval(function () {
            if (numberOfBlinks > 0) {
                if (highlighted) {
                    highlighted = false;
                    path.setFillStyle(fillStyle);
                    for (i = 0; i < len; i++) {
                        points[i].setFillStyle(fillStyle);
                    }
                    svl.canvas.clear().render2();
                } else {
                    highlighted = true;
                    path.setFillStyle(fillStyleHighlight);
                    for (i = 0; i < len; i++) {
                        points[i].setFillStyle(fillStyleHighlight);
                    }
                    svl.canvas.clear().render2();
                    numberOfBlinks -= 1;
                }
            } else {
                if (fade) {
                    path.setFillStyle(fillStyle);
                    for (i = 0; i < len; i++) {
                        points[i].setFillStyle(fillStyle);
                    }
                    svl.canvas.clear().render2();
                }

                setAlpha(0.05);
                svl.canvas.clear().render2();
                window.clearInterval(interval);
            }
        }, 500);

        return this;
    }

    /**
     * This method creates a Google Maps marker.
     * https://developers.google.com/maps/documentation/javascript/markers
     * https://developers.google.com/maps/documentation/javascript/examples/marker-remove
     * @returns {google.maps.Marker}
     */
    function createGoogleMapsMarker (labelType) {
        if (typeof google != "undefined") {
            var latlng = toLatLng(),
                googleLatLng = new google.maps.LatLng(latlng.lat, latlng.lng),
                imagePaths = svl.misc.getIconImagePaths(),
                url = imagePaths[labelType].googleMapsIconImagePath

            return new google.maps.Marker({
                position: googleLatLng,
                map: svl.map.getMap(),
                title: "Hi!",
                icon: url,
                size: new google.maps.Size(20, 20)
            });
        }
    }

    /**
     * This method turn the associated Path and Points into gray.
     * @param mode
     * @returns {fadeFillStyle}
     */
    function fadeFillStyle (mode) {
        var path = getPath(),
            points = path.getPoints(),
            len = points.length, fillStyle;

        if (!mode) { mode = 'default'; }

        fillStyle = mode == 'gray' ? 'rgba(200,200,200,0.5)' : 'rgba(255,165,0,0.8)';
        path.setFillStyle(fillStyle);
        for (var i = 0; i < len; i++) {
            points[i].setFillStyle(fillStyle);
        }
        return this;
    }

    /**
     * This method changes the fill color of the path and points that constitute the path.
     * @param fillColor
     * @returns {fill}
     */
    function fill (fillColor) {
        var path = getPath(), points = path.getPoints(), len = points.length;
        path.setFillStyle(fillColor);
        for (var i = 0; i < len; i++) { points[i].setFillStyle(fillColor); }
        return this;
    }

    /**
     * This method returns the boudning box of the label's outline.
     * @param pov
     * @returns {*}
     */
    function getBoundingBox (pov) {
        return getPath().getBoundingBox(pov);
    }

    /**
     * This function returns the coordinate of a point.
     * @returns {*}
     */
    function getCoordinate () {
        if (path && path.points.length > 0) {
            var pov = svl.map.getPov();
            return $.extend(true, {}, path.points[0].getCanvasCoordinate(pov));
        }
        return path;
    }

    /**
     * This function return the coordinate of a point in the GSV image coordinate.
     * @returns {*}
     */
    function getGSVImageCoordinate () {
        if (path && path.points.length > 0) {
            return path.points[0].getGSVImageCoordinate();
        }
    }

    /**
     * Get image coordinates of the child path
     * @returns {*}
     */
    function getImageCoordinates () {
        return path ? path.getImageCoordinates() : false;
    }

    /**
     * This function returns labelId property
     * @returns {string}
     */
    function getLabelId () {
        return properties.labelId;
    }

    /**
     * This function returns labelType property
     * @returns {*}
     */
    function getLabelType () { return properties.labelType; }

    /**
     * This function returns the coordinate of a point.
     * If reference is true, return a reference to the path instead of a copy of the path
     * @param reference
     * @returns {*}
     */
    function getPath (reference) {
        if (path) {
            return reference ? path : $.extend(true, {}, path);
        }
        return false;
    }

    /**
     * This function returns the coordinate of the first point in the path.
     * @returns {*}
     */
    function getPoint () { return (path && path.points.length > 0) ? path.points[0] : path; }

    /**
     * This function returns the point objects that constitute the path
     * If reference is set to true, return the reference to the points
     * @param reference
     * @returns {*}
     */
    function getPoints (reference) { return path ? path.getPoints(reference) : false; }

    /**
     * This method returns the pov of this label
     * @returns {{heading: Number, pitch: Number, zoom: Number}}
     */
    function getLabelPov () {
        var heading, pitch = parseInt(properties.panoramaPitch, 10),
            zoom = parseInt(properties.panoramaZoom, 10),
            points = getPoints(),
            svImageXs = points.map(function(point) { return point.svImageCoordinate.x; }),
            labelSvImageX;

        if (svImageXs.max() - svImageXs.min() > (svl.svImageWidth / 2)) {
            svImageXs = svImageXs.map(function (x) {
                if (x < (svl.svImageWidth / 2)) {
                    x += svl.svImageWidth;
                }
                return x;
            });
            labelSvImageX = parseInt(svImageXs.mean(), 10) % svl.svImageWidth;
        } else {
            labelSvImageX = parseInt(svImageXs.mean(), 10);
        }
        heading = parseInt((labelSvImageX / svl.svImageWidth) * 360, 10) % 360;

        return {
            heading: parseInt(heading, 10),
            pitch: pitch,
            zoom: zoom
        };
    }

    /**
     * Return the deep copy of the properties object,
     * so the caller can only modify properties from
     * setProperties() (which I have not implemented.)
     * JavaScript Deepcopy
     * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
     */
    function getProperties () { return $.extend(true, {}, properties); }

    /**
     * Get a property
     * @param propName
     * @returns {boolean}
     */
    function getProperty (propName) { return (propName in properties) ? properties[propName] : false; }

    /**
     * Get a status
     * @param key
     * @returns {*}
     */
    function getStatus (key) { return status[key]; }

    function getVisibility () { return status.visibility; }

    /**
     * This method changes the fill color of the path and points to orange.
     */
    function highlight () { return fill('rgba(255,165,0,0.8)'); }

    /**
     * Check if the label is deleted
     * @returns {boolean}
     */
    function isDeleted () { return status.deleted; }


    /**
     * Check if a path is under a cursor
     * @param x
     * @param y
     * @returns {boolean}
     */
    function isOn (x, y) {
        if (status.deleted || status.visibility === 'hidden') {  return false; }
        var result = path.isOn(x, y);
        return result ? result : false;
    }

    /**
     * This method returns the visibility of this label.
     * @returns {boolean}
     */
    function isVisible () {
        return status.visibility === 'visible';
    }

    /**
     * Lock tag visibility
     * @returns {lockTagVisibility}
     */
    function lockTagVisibility () {
        lock.tagVisibility = true;
        return this;
    }

    /**
     * Lock visibility
     * @returns {lockVisibility}
     */
    function lockVisibility () {
        lock.visibility = true;
        return this;
    }

    /**
     * This method calculates the area overlap between this label and another label passed as an argument.
     * @param label
     * @param mode
     * @returns {*|number}
     */
    function overlap (label, mode) {
        if (!mode) mode = "boundingbox";
        if (mode !== "boundingbox") { throw self.className + ": " + mobede + " is not a valid option."; }
        var path1 = getPath(),
            path2 = label.getPath();
        return path1.overlap(path2, mode);
    }

    /**
     * Remove the label (it does not actually remove, but hides the label and set its status to 'deleted').
     */
    function remove () {
        setStatus('deleted', true);
        setStatus('visibility', 'hidden');
    }

    /**
     * This function removes the path and points in the path.
     */
    function removePath () {
        path.removePoints();
        path = undefined;
    }

    /**
     * This method renders this label on a canvas.
     * @param ctx
     * @param pov
     * @param evaluationMode
     * @returns {self}
     */
    function render (ctx, pov, evaluationMode) {
        if (!evaluationMode) {
            evaluationMode = false;
        }
        if (!status.deleted) {
            if (status.visibility === 'visible') {
                // Render a tag
                // Get a text to render (e.g, attribute type), and
                // canvas coordinate to render the tag.
                if(status.tagVisibility == 'visible') {
                    renderTag(ctx);
                    // path.renderBoundingBox(ctx);
                    showDelete();
                }

                // Render a path
                path.render2(ctx, pov);
            } else if (false) {
                // Render labels that are not in the current panorama but are close enough.
                // Get the label'svar latLng = toLatLng();
                var currLat = svl.panorama.location.latLng.lat(),
                    currLng = svl.panorama.location.latLng.lng();
                var d = svl.util.math.haversine(currLat, currLng, latLng.lat, latLng.lng);
                var offset = toOffset();

                if (d < properties.distanceThreshold) {
                    var dPosition = svl.util.math.latlngInverseOffset(currLat, currLat - latLng.lat, currLng - latLng.lng);

                    var dx = offset.dx - dPosition.dx;
                    var dy = offset.dy - dPosition.dy;
                    var dz = offset.dz;

                    var idx = svl.pointCloud.search(svl.panorama.pano, {x: dx, y: dy, z: dz});
                    var ix = idx / 3 % 512;
                    var iy = (idx / 3 - ix) / 512;
                    var imageCoordinateX = ix * 26;
                    var imageCoordinateY = 3328 - iy * 26;
                    var canvasPoint = svl.misc.imageCoordinateToCanvasCoordinate(imageCoordinateX, imageCoordinateY, pov);

                    console.log(canvasPoint);
                    ctx.save();
                    ctx.strokeStyle = 'rgba(255,255,255,1)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(canvasPoint.x, canvasPoint.y, 10, 2 * Math.PI, 0, true);
                    ctx.closePath();
                    ctx.stroke();
                    ctx.fillStyle = path.getProperty('fillStyle'); // changeAlphaRGBA(properties.fillStyleInnerCircle, 0.5);
                    ctx.fill();
                    ctx.restore();

                    //new Point(tempPath[i].x, tempPath[i].y, pov, pointParameters)
                    //new Label(new Path(), params)
                }
            }
        }

        // Show a label on the google maps pane.
        if (!isDeleted()) {
            if (googleMarker && !googleMarker.map) {
                googleMarker.setMap(svl.map.getMap());
            }
        } else {
            if (googleMarker && googleMarker.map) {
                googleMarker.setMap(null);
            }
        }
        return this;
    }

    /**
     * This function renders a tag on a canvas to show a property of the label
     * @param ctx
     * @returns {boolean}
     */
    function renderTag(ctx) {
        if ('contextMenu' in svl && svl.contextMenu.isOpen()) { return false; }

        var labelCoordinate = getCoordinate(),
            cornerRadius = 3,
            i, w, height, width,
            msg = properties.labelDescription,
            messages = msg.split('\n'),
            padding = { left: 12, right: 5, bottom: 0, top: 18};

        if (properties.labelerId !== 'DefaultValue') { messages.push('Labeler: ' + properties.labelerId); }

        // Set rendering properties and draw a tag
        ctx.save();
        ctx.font = '10.5pt Calibri';
        height = properties.tagHeight * messages.length;
        width = -1;
        for (i = 0; i < messages.length; i += 1) {
            w = ctx.measureText(messages[i]).width + 5;
            if (width < w) { width = w; }
        }
        properties.tagWidth = width;

        ctx.lineCap = 'square';
        ctx.lineWidth = 2;
        ctx.fillStyle = svl.util.color.changeAlphaRGBA(svl.misc.getLabelColors(getProperty('labelType')), 0.9);
        ctx.strokeStyle = 'rgba(255,255,255,1)';

        // Tag background
        ctx.beginPath();
        ctx.moveTo(labelCoordinate.x + cornerRadius, labelCoordinate.y);
        ctx.lineTo(labelCoordinate.x + width + padding.left + padding.right - cornerRadius, labelCoordinate.y);
        ctx.arc(labelCoordinate.x + width + padding.left + padding.right, labelCoordinate.y + cornerRadius, cornerRadius, 3 * Math.PI / 2, 0, false); // Corner
        ctx.lineTo(labelCoordinate.x + width + padding.left + padding.right + cornerRadius, labelCoordinate.y + height + padding.bottom);
        ctx.arc(labelCoordinate.x + width + padding.left + padding.right, labelCoordinate.y + height + cornerRadius, cornerRadius, 0, Math.PI / 2, false); // Corner
        ctx.lineTo(labelCoordinate.x + cornerRadius, labelCoordinate.y + height + 2 * cornerRadius);
        ctx.arc(labelCoordinate.x + cornerRadius, labelCoordinate.y + height + cornerRadius, cornerRadius, Math.PI / 2, Math.PI, false);
        ctx.lineTo(labelCoordinate.x, labelCoordinate.y + cornerRadius);
        ctx.fill();
        ctx.stroke();
        ctx.closePath();

        // Tag text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(messages[0], labelCoordinate.x + padding.left, labelCoordinate.y + padding.top);
        ctx.restore();
    }

    /**
     * This method turn the fill color of associated Path and Points into their original color.
     * @returns {resetFillStyle}
     */
    function resetFillStyle () {
        var path = getPath(), points = path.getPoints(),
            i, len = points.length;
        path.resetFillStyle();
        for (i = 0; i < len; i++) {
            points[i].resetFillStyle();
        }
        return this;
    }

    /**
     * This function sets properties.tag.x and properties.tag.y to 0
     * @returns {resetTagCoordinate}
     */
    function resetTagCoordinate () {
        properties.tagX = 0;
        properties.tagY = 0;
        return this;
    }

    /**
     * This method changes the alpha channel of the fill color of the path and points that constitute the path.
     * @param alpha
     * @returns {setAlpha}
     */
    function setAlpha (alpha) {
        var path = getPath(),
            points = path.getPoints(),
            len = points.length,
            fillColor = path.getFill();
        alpha = alpha ? alpha : 0.3;
        fillColor = svl.util.color.changeAlphaRGBA(fillColor, alpha);
        path.setFillStyle(fillColor);
        for (var i = 0; i < len; i++) {
            points[i].setFillStyle(fillColor);
        }
        return this;
    }

    /**
     * This function sets the icon path of the point this label holds.
     * @param iconPath
     * @returns {*}
     */
    function setIconPath (iconPath) {
        if (path && path.points[0]) {
            var point = path.points[0];
            point.setIconPath(iconPath);
            return this;
        }
        return false;
    }

    /**
     * Set the labeler id
     * @param labelerIdIn
     * @returns {setLabelerId}
     */
    function setLabelerId (labelerIdIn) {
        properties.labelerId = labelerIdIn;
        return this;
    }

    /**
     * Sets a property
     * @param key
     * @param value
     * @returns {setProperty}
     */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Set status
     * @param key
     * @param value
     */
    function setStatus (key, value) {
        if (key in status) {
            if (key === 'visibility' && (value === 'visible' || value === 'hidden')) {
                setVisibility(value);
            } else if (key === 'tagVisibility' && (value === 'visible' || value === 'hidden')) {
                setTagVisibility(value);
            } else if (key === 'deleted' && typeof value === 'boolean') {
                status[key] = value;
            }
        }
    }

    /**
     * Set the visibility of the tag
     * @param visibility {string} visible or hidden
     * @returns {setTagVisibility}
     */
    function setTagVisibility (visibility) {
        if (!lock.tagVisibility) {
            if (visibility === 'visible' || visibility === 'hidden') {
                status['tagVisibility'] = visibility;
            }
        }
        return this;
    }

    /**
     * This function sets the sub label type of this label. E.g. for a bus stop there are StopSign_OneLeg
     * @param labelType
     * @returns {setSubLabelDescription}
     */
    function setSubLabelDescription (labelType) {
        var labelDescriptions = svl.misc.getLabelDescriptions();
        properties.labelProperties.subLabelDescription = labelDescriptions[labelType].text;
        return this;
    }

    /**
     * Set this label's visibility to the passed visibility
     * @param visibility
     * @param labelerIds
     * @param included
     * @returns {setVisibilityBasedOnLabelerId}
     */
    function setVisibilityBasedOnLabelerId (visibility, labelerIds, included) {
        if (included === undefined) {
            if (labelerIds.indexOf(properties.labelerId) !== -1) {
                unlockVisibility().setVisibility(visibility).lockVisibility();
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                unlockVisibility().setVisibility(visibility).lockVisibility();
            }
        } else {
            if (included) {
                if (labelerIds.indexOf(properties.labelerId) !== -1) {
                    unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            } else {
                if (labelerIds.indexOf(properties.labelerId) === -1) {
                    unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            }
        }

        return this;
    }

    /**
     * Set the visibility of the label
     * @param visibility
     * @returns {setVisibility}
     */
    function setVisibility (visibility) {
        if (!lock.visibility) { status.visibility = visibility; }
        return this;
    }

    /**
     * Set visibility of labels
     * @param visibility
     * @param panoId
     * @returns {setVisibilityBasedOnLocation}
     */
    function setVisibilityBasedOnLocation (visibility, panoramaId) {
        if (!status.deleted) {
            if (panoramaId === properties.panoId) {
                setVisibility(visibility);
            } else {
                visibility = visibility == 'visible' ? 'hidden' : 'visible';
                setVisibility(visibility);
            }
        }
        return this;
    }

    /**
     *
     * @param visibility
     * @param tables
     * @param included
     */
    function setVisibilityBasedOnLabelerIdAndLabelTypes (visibility, tables, included) {
        var tablesLen = tables.length, matched = false;

        for (var i = 0; i < tablesLen; i += 1) {
            if (tables[i].userIds.indexOf(properties.labelerId) !== -1) {
                if (tables[i].labelTypesToRender.indexOf(properties.labelProperties.labelType) !== -1) {
                    matched = true;
                }
            }
        }
        if (included === undefined) {
            if (matched) {
                unlockVisibility().setVisibility(visibility).lockVisibility();
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                unlockVisibility().setVisibility(visibility).lockVisibility();
            }
        } else {
            if (included) {
                if (matched) {
                    unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            } else {
                if (!matched) {
                    unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            }
        }
    }

    /**
     * Show the delete button
     */
    function showDelete() {
        if (status.tagVisibility !== 'hidden') {
            var boundingBox = path.getBoundingBox(),
                x = boundingBox.x + boundingBox.width - 20,
                y = boundingBox.y;

            // Show a delete button
            $("#delete-icon-holder").css({
                visibility: 'visible',
                left : x + 25, // + width - 5,
                top : y - 20
            });
        }
    }

    /**
     * Calculate the offset to the label
     * @returns {{dx: number, dy: number, dz: number}}
     */
    function toOffset() {
        var imageCoordinates = path.getImageCoordinates(),
            pc = svl.pointCloud.getPointCloud(properties.panoId);
        if (pc) {
            var minDx = 1000, minDy = 1000, minDz = 1000,
                i, p, idx, dx, dy, dz, r, minR;
            for (i = 0; i < imageCoordinates.length; i++) {
                p = svl.util.scaleImageCoordinate(imageCoordinates[i].x, imageCoordinates[i].y, 1 / 26);
                idx = 3 * (Math.ceil(p.x) + 512 * Math.ceil(p.y));
                dx = pc.pointCloud[idx];
                dy = pc.pointCloud[idx + 1];
                dz = pc.pointCloud[idx + 2];
                r = dx * dx + dy * dy;
                minR = minDx * minDx + minDy + minDy;

                if (r < minR) {
                    minDx = dx;
                    minDy = dy;
                    minDz = dz;
                }
            }
            return {dx: minDx, dy: minDy, dz: minDz};
        }
    }

    /**
     * Get the label latlng position
     * @returns {labelLatLng}
     */
    function toLatLng() {
        if (!properties.labelLat) {
            var imageCoordinates = path.getImageCoordinates(),
                pc = svl.pointCloud.getPointCloud(properties.panoId);
            if (pc) {
                var minDx = 1000, minDy = 1000, i, delta, latlng,
                    p, idx, dx, dy, r, minR;
                for (i = 0; i < imageCoordinates.length; i ++) {
                    p = svl.util.scaleImageCoordinate(imageCoordinates[i].x, imageCoordinates[i].y, 1/26);
                    idx = 3 * (Math.ceil(p.x) + 512 * Math.ceil(p.y));
                    dx = pc.pointCloud[idx];
                    dy = pc.pointCloud[idx + 1];
                    r = dx * dx + dy * dy;
                    minR = minDx * minDx + minDy + minDy;

                    if (r < minR) {
                        minDx = dx;
                        minDy = dy;
                    }
                }
                delta = svl.util.math.latlngOffset(properties.panoramaLat, dx, dy);
                latlng = {lat: properties.panoramaLat + delta.dlat, lng: properties.panoramaLng + delta.dlng};
                setProperty('labelLat', latlng.lat);
                setProperty('labelLng', latlng.lng);
                return latlng;
            } else {
                return null;
            }
        } else {
            return { lat: getProperty('labelLat'), lng: getProperty('labelLng') };  // Return the cached value
        }

    }

    /**
     * Unlock status.visibility
     * @returns {unlockVisibility}
     */
    function unlockVisibility () {
        lock.visibility = false;
        return this;
    }

    /**
     * Unlock status.tagVisibility
     * @returns {unlockTagVisibility}
     */
    function unlockTagVisibility () {
        lock.tagVisibility = false;
        return this;
    }

    self.resetFillStyle = resetFillStyle;
    self.blink = blink;
    self.fadeFillStyle = fadeFillStyle;
    self.getBoundingBox = getBoundingBox;
    self.getGSVImageCoordinate = getGSVImageCoordinate;
    self.getImageCoordinates = getImageCoordinates;
    self.getLabelId = getLabelId;
    self.getLabelType = getLabelType;
    self.getPath = getPath;
    self.getPoint = getPoint;
    self.getPoints = getPoints;
    self.getLabelPov = getLabelPov;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.getstatus = getStatus;
    self.getVisibility = getVisibility;
    self.fill = fill;
    self.isDeleted = isDeleted;
    self.isOn = isOn;
    self.isVisible = isVisible;
    self.highlight = highlight;
    self.lockTagVisibility = lockTagVisibility;
    self.lockVisibility = lockVisibility;
    self.overlap = overlap;
    self.removePath = removePath;
    self.render = render;
    self.remove = remove;
    self.resetTagCoordinate = resetTagCoordinate;
    self.setAlpha = setAlpha;
    self.setIconPath = setIconPath;
    self.setLabelerId = setLabelerId;
    self.setProperty = setProperty;
    self.setStatus = setStatus;
    self.setTagVisibility = setTagVisibility;
    self.setSubLabelDescription = setSubLabelDescription;
    self.setVisibility = setVisibility;
    self.setVisibilityBasedOnLocation = setVisibilityBasedOnLocation;
    self.setVisibilityBasedOnLabelerId = setVisibilityBasedOnLabelerId;
    self.setVisibilityBasedOnLabelerIdAndLabelTypes = setVisibilityBasedOnLabelerIdAndLabelTypes;
    self.unlockTagVisibility = unlockTagVisibility;
    self.unlockVisibility = unlockVisibility;
    self.toLatLng = toLatLng;

    if (!_init(params, pathIn)) {
        return false;
    }
    return self;
}

/**
 * Label Container module. This is responsible of storing the label objects that were created in the current session.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelContainer() {
    var self = {className: 'LabelContainer'};
    var currentCanvasLabels = [],
        prevCanvasLabels = [];

    /** Returns canvas labels */
    function getCanvasLabels () { return prevCanvasLabels.concat(currentCanvasLabels); }

    /** Get current label */
    function getCurrentLabels () { return currentCanvasLabels; }

    /** Load labels */
    function load () { currentCanvasLabels = svl.storage.get("labels"); }

    /**
     * Push a label into canvasLabels
     * @param label
     */
    function push(label) {
        currentCanvasLabels.push(label);
        svl.labelCounter.increment(label.getProperty("labelType"));
        
        // Keep panorama meta data, especially the date when the Street View picture was taken to keep track of when the problem existed
        var panoramaId = label.getProperty("panoId");
        if ("panoramaContainer" in svl && svl.panoramaContainer && panoramaId && !svl.panoramaContainer.getPanorama(panoramaId)) {
            svl.panoramaContainer.fetchPanoramaMetaData(panoramaId);
        }
    }

    /** Refresh */
    function refresh () {
        prevCanvasLabels = prevCanvasLabels.concat(currentCanvasLabels);
        currentCanvasLabels = [];
    }

    /**  Flush the canvasLabels */
    function removeAll() { currentCanvasLabels = []; }

    /**
     * This function removes a passed label and its child path and points
     * @method
     */
    function removeLabel (label) {
        if (!label) { return false; }
        svl.tracker.push('RemoveLabel', {labelId: label.getProperty('labelId')});
        svl.labelCounter.decrement(label.getProperty("labelType"));
        label.remove();

        // Review label correctness if this is a ground truth insertion task.
        if (("goldenInsertion" in svl) &&
            svl.goldenInsertion &&
            svl.goldenInsertion.isRevisingLabels()) {
            svl.goldenInsertion.reviewLabels();
        }

        svl.canvas.clear();
        svl.canvas.render();
        return this;
    }

    function save () {
        svl.storage.set("labels", currentCanvasLabels);
    }


    self.getCanvasLabels = getCanvasLabels;
    self.getCurrentLabels = getCurrentLabels;
//    self.load = load;
    self.push = push;
    self.refresh = refresh;
    self.removeAll = removeAll;
    self.removeLabel = removeLabel;
//    self.save = save;
    return self;
}
/**
 * LabelFactory module.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelFactory () {
    var self = { className: "LabelFactory" },
        temporaryLabelId = 1;

    function create (path, param) {
        var label = new Label(path, param);
        if (label) {
            if (!('labelId' in param)) {
                label.setProperty("temporary_label_id", temporaryLabelId);
                temporaryLabelId++;
            }
            return label;
        }
    }

    self.create = create;
    return self;
}
/**
 * Path module. A Path instance holds and array of Point instances.
 * @param points
 * @param params
 * @returns {{className: string, points: undefined}}
 * @constructor
 * @memberof svl
 */
function Path (points, params) {
    var self = { className : 'Path', points : undefined };
    var parent;
    var properties = {
        fillStyle: 'rgba(255,255,255,0.5)',
        lineCap : 'round', // ['butt','round','square']
        lineJoin : 'round', // ['round','bevel','miter']
        lineWidth : '3',
        numPoints: points.length,
        originalFillStyle: 'rgba(255,255,255,0.5)',
        originalStrokeStyle: 'rgba(255,255,255,1)',
        strokeStyle : 'rgba(255,255,255,1)',
        strokeStyle_bg : 'rgba(255,255,255,1)' //potentially delete
    };
    var status = {
        visibility: 'visible'
    };

    function _init(points, params) {
        var lenPoints;
        var i;
        self.points = points;
        lenPoints = points.length;

        // Set belongs to of the points
        for (i = 0; i < lenPoints; i += 1) {
            points[i].setBelongsTo(self);
        }

        if (params) {
            for (var attr in params) {
                if (attr in properties) {
                    properties[attr] = params[attr];
                }
            }
        }
        properties.fillStyle = svl.util.color.changeAlphaRGBA(points[0].getProperty('fillStyleInnerCircle'), 0.5);
        properties.originalFillStyle = properties.fillStyle;
        properties.originalStrokeStyle = properties.strokeStyle;
    }

    /**
     * This method returns the Label object that this path belongs to.
     * @returns {object|null} Label object.
     */
    function belongsTo () {
        return parent ? parent : null;
    }

    /**
     * This function checks if a mouse cursor is on any of a points and return
     * @param povIn
     * @returns {{x: number, y: number, width: number, height: number}}
     */
    function getBoundingBox(povIn) {
        var pov = povIn ? povIn : svl.map.getPov();
        var canvasCoords = getCanvasCoordinates(pov);
        var xMin, xMax, yMin, yMax, width, height;
        if (points.length > 2) {
            xMax = -1;
            xMin = 1000000;
            yMax = -1;
            yMin = 1000000;

            for (var j = 0; j < canvasCoords.length; j += 1) {
                var coord = canvasCoords[j];
                if (coord.x < xMin) { xMin = coord.x; }
                if (coord.x > xMax) { xMax = coord.x; }
                if (coord.y < yMin) { yMin = coord.y; }
                if (coord.y > yMax) { yMax = coord.y; }
            }
            width = xMax - xMin;
            height = yMax - yMin;
        } else {
            xMin = canvasCoords[0].x;
            yMin = canvasCoords[0].y;
            width = 0;
            height = 0;
        }

        return { x: xMin, y: yMin, width: width, height: height };
    }

    /**
     * Returns fill color of the path
     * @returns {string}
     */
    function getFill() {
        return properties.fillStyle;
    }

    /**
     * Get canvas coordinate
     * @param pov
     * @returns {Array}
     */
    function getCanvasCoordinates (pov) {
        // Get canvas coordinates of points that constitute the path.
        var imCoords = getImageCoordinates(), i, len = imCoords.length, canvasCoord, canvasCoords = [], min = 10000000, max = -1;

        for (i = 0; i < len; i += 1) {
            if (min > imCoords[i].x) {
                min = imCoords[i].x;
            }
            if (max < imCoords[i].x) {
                max = imCoords[i].x;
            }
        }
        // Note canvasWidthInGSVImage is approximately equals to the image width of GSV image that fits in one canvas view
        var canvasWidthInGSVImage = 3328;
        for (i = 0; i < len; i += 1) {
            if (pov.heading < 180) {
                if (max > svl.svImageWidth - canvasWidthInGSVImage) {
                    if (imCoords[i].x > canvasWidthInGSVImage) {
                        imCoords[i].x -= svl.svImageWidth;
                    }
                }
            } else {
                if (min < canvasWidthInGSVImage) {
                    if (imCoords[i].x < svl.svImageWidth - canvasWidthInGSVImage) {
                        imCoords[i].x += svl.svImageWidth;
                    }
                }
            }
            canvasCoord = svl.gsvImageCoordinate2CanvasCoordinate(imCoords[i].x, imCoords[i].y, pov);
            canvasCoords.push(canvasCoord);
        }

        return canvasCoords;
    }

    /**
     * This method returns an array of image coordinates of points
     * @returns {Array}
     */
    function getImageCoordinates() {
        var i, len = self.points.length, coords = [];
        for (i = 0; i < len; i += 1) {
            coords.push(self.points[i].getGSVImageCoordinate());
        }
        return coords;
    }

    /**
     * Returns the line width
     * @returns {string}
     */
    function getLineWidth () {
        return properties.lineWidth;
    }

    /**
     * This function returns points.
     */
    function getPoints (reference) {
        if (!reference) {
            reference = false;
        }

        if (reference) {
            // return self.points;
            return points;
        } else {
            // return $.extend(true, [], self.points);
            return $.extend(true, [], points);
        }
    }

    /**
     * This method returns a property
     * @param key The field name of the property
     * @returns {*}
     */
    function getProperty (key) {
        return properties[key];
    }

    /**
     * This method returns the status of the field
     * @param key {string} The field name
     */
    function getStatus (key) {
        return status[key];
    }

    /**
     * this method returns a bounding box in terms of svImage coordinates.
     * @returns {{x: number, y: number, width: number, height: number, boundary: boolean}}
     */
    function getSvImageBoundingBox() {
        var i;
        var coord;
        var coordinates = getImageCoordinates();
        var len = coordinates.length;
        var xMax = -1;
        var xMin = 1000000;
        var yMax = -1000000;
        var yMin = 1000000;
        var boundary = false;

        //
        // Check if thie is an boundary case
        for (i = 0; i < len; i++) {
            coord = coordinates[i];
            if (coord.x < xMin) {
                xMin = coord.x;
            }
            if (coord.x > xMax) {
                xMax = coord.x;
            }
            if (coord.y < yMin) {
                yMin = coord.y;
            }
            if (coord.y > yMax) {
                yMax = coord.y;
            }
        }

        if (xMax - xMin > 5000) {
            boundary = true;
            xMax = -1;
            xMin = 1000000;

            for (i = 0; i < len; i++) {
                coord = coordinates[i];
                if (coord.x > 6000) {
                    if (coord.x < xMin) {
                        xMin = coord.x;
                    }
                } else {
                    if (coord.x > xMax){
                        xMax = coord.x;
                    }
                }
            }
        }

        // If the path is on boundary, swap xMax and xMin.
        if (boundary) {
            return {
                x: xMin,
                y: yMin,
                width: (svl.svImageWidth - xMin) + xMax,
                height: yMax - yMin,
                boundary: true
            }
        } else {
            return {
                x: xMin,
                y: yMin,
                width: xMax - xMin,
                height: yMax - yMin,
                boundary: false
            }
        }
    }

    /**
     * This function checks if a mouse cursor is on any of a points and return a point if the cursor is indeed on the
     * point. Otherwise, this function checks if the mouse cursor is on a bounding box of this path. If the cursor is
     * on the bounding box, then this function returns this path object.
     * @param x
     * @param y
     * @returns {*}
     */
    function isOn (x, y) {
        var boundingBox, i, j, point, pointsLen, result;

        // Check if the passed point (x, y) is on any of points.
        pointsLen = self.points.length;
        for (j = 0; j < pointsLen; j += 1) {
            point = self.points[j];
            result = point.isOn(x, y);
            if (result) {
                return result;
            }
        }

        // Check if the passed point (x, y) is on a path bounding box
        boundingBox = getBoundingBox();
        if (boundingBox.x < x &&
            boundingBox.x + boundingBox.width > x &&
            boundingBox.y < y &&
            boundingBox.y + boundingBox.height > y) {
            return this;
        } else {
            return false;
        }
    }

    /**
     * This method calculates the area overlap between bouding boxes of this path and
     * another path passed as an argument.
     * @param path
     * @param mode
     * @returns {number}
     */
    function overlap (path, mode) {
        if (!mode) {
            mode = "boundingbox";
        }

        var overlap = 0;

        if (mode === "boundingbox") {
            var boundingbox1 = getSvImageBoundingBox();
            var boundingbox2 = path.getSvImageBoundingBox();
            var xOffset;
            var yOffset;

            //
            // Check if a bounding box is on a boundary
            if (!(boundingbox1.boundary && boundingbox2.boundary)) {
                if (boundingbox1.boundary) {
                    boundingbox1.x = boundingbox1.x - svl.svImageWidth;
                    if (boundingbox2.x > 6000) {
                        boundingbox2.x = boundingbox2.x - svl.svImageWidth;
                    }
                } else if (boundingbox2.boundary) {
                    boundingbox2.x = boundingbox2.x - svl.svImageWidth;
                    if (boundingbox1.x > 6000) {
                        boundingbox1.x = boundingbox1.x - svl.svImageWidth;
                    }
                }
            }


            if (boundingbox1.x < boundingbox2.x) {
                xOffset = boundingbox1.x;
            } else {
                xOffset = boundingbox2.x;
            }
            if (boundingbox1.y < boundingbox2.y) {
                yOffset = boundingbox1.y;
            } else {
                yOffset = boundingbox2.y;
            }

            boundingbox1.x -= xOffset;
            boundingbox2.x -= xOffset;
            boundingbox1.y -= yOffset;
            boundingbox2.y -= yOffset;

            var b1x1 = boundingbox1.x;
            var b1x2 = boundingbox1.x + boundingbox1.width;
            var b1y1 = boundingbox1.y;
            var b1y2 = boundingbox1.y + boundingbox1.height;
            var b2x1 = boundingbox2.x;
            var b2x2 = boundingbox2.x + boundingbox2.width;
            var b2y1 = boundingbox2.y;
            var b2y2 = boundingbox2.y + boundingbox2.height;
            var row = 0;
            var col = 0;
            var rowMax = (b1x2 < b2x2) ? b2x2 : b1x2;
            var colMax = (b1y2 < b2y2) ? b2y2 : b1y2;
            var countUnion = 0;
            var countIntersection = 0;
            var isOnB1 = false;
            var isOnB2 = false;

            for (row = 0; row < rowMax; row++) {
                for (col = 0; col < colMax; col++) {
                    isOnB1 = (b1x1 < row && row < b1x2) && (b1y1 < col && col < b1y2);
                    isOnB2 = (b2x1 < row && row < b2x2) && (b2y1 < col && col < b2y2);
                    if (isOnB1 && isOnB2) {
                        countIntersection += 1;
                    }
                    if (isOnB1 || isOnB2) {
                        countUnion += 1;
                    }
                }
            }
            overlap = countIntersection / countUnion;
        }

        return overlap;
    }

    /**
     * This method remove all the points in the list points.
     */
    function removePoints () {
        self.points = undefined;
    }

    /**
     * This method renders a path.
     * @param pov
     * @param ctx
     */
    function render (pov, ctx) {
        if (status.visibility === 'visible') {
            var j, pathLen, point, currCoord, prevCoord;

            pathLen = self.points.length;

            // Get canvas coordinates to render a path.
            var canvasCoords = getCanvasCoordinates(pov);

            // Set the fill color
            point = self.points[0];
            ctx.save();
            ctx.beginPath();
            if (!properties.fillStyle) {
                properties.fillStyle = svl.util.color.changeAlphaRGBA(point.getProperty('fillStyleInnerCircle'), 0.5);
                properties.originalFillStyle = properties.fillStyle;
                ctx.fillStyle = properties.fillStyle;
            } else {
                ctx.fillStyle = properties.fillStyle;
            }

            if (pathLen > 1) {
                // Render fill
                ctx.moveTo(canvasCoords[0].x, canvasCoords[0].y);
                for (j = 1; j < pathLen; j += 1) {
                    ctx.lineTo(canvasCoords[j].x, canvasCoords[j].y);
                }
                ctx.lineTo(canvasCoords[0].x, canvasCoords[0].y);
                ctx.fill();
                ctx.closePath();
                ctx.restore();
            }

            // Render points
            for (j = 0; j < pathLen; j += 1) {
                point = self.points[j];
                point.render(pov, ctx);
            }

            if (pathLen > 1) {
                // Render segments
                for (j = 0; j < pathLen; j += 1) {
                    if (j > 0) {
                        currCoord = canvasCoords[j];
                        prevCoord = canvasCoords[j - 1];
                    } else {
                        currCoord = canvasCoords[j];
                        prevCoord = canvasCoords[pathLen - 1];
                    }
                    var r = point.getProperty('radiusInnerCircle');
                    ctx.save();
                    ctx.strokeStyle = properties.strokeStyle;
                    svl.util.shape.lineWithRoundHead(ctx, prevCoord.x, prevCoord.y, r, currCoord.x, currCoord.y, r);
                    ctx.restore();
                }
            }
        }
    }

    function render2 (ctx, pov) {
        return render(pov, ctx);
    }

    /**
     * This method renders a bounding box around a path.
     * @param ctx
     */
    function renderBoundingBox (ctx) {
        // This function takes a bounding box returned by a method getBoundingBox()
        var boundingBox = getBoundingBox();

        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,1)';
        ctx.beginPath();
        ctx.moveTo(boundingBox.x, boundingBox.y);
        ctx.lineTo(boundingBox.x + boundingBox.width, boundingBox.y);
        ctx.lineTo(boundingBox.x + boundingBox.width, boundingBox.y + boundingBox.height);
        ctx.lineTo(boundingBox.x, boundingBox.y + boundingBox.height);
        ctx.lineTo(boundingBox.x, boundingBox.y);
        ctx.stroke();
        ctx.closePath();
        ctx.restore();
    }
    
    /**
     * This method changes the value of fillStyle to its original fillStyle value
     * @returns {self}
     */
    function resetFillStyle () {
        properties.fillStyle = properties.originalFillStyle;
        return this;
    }

    /**
     * This method resets the strokeStyle to its original value
     * @returns {self}
     */
    function resetStrokeStyle () {
        properties.strokeStyle = properties.originalStrokeStyle;
        return this;
    }

    /**
     * This method sets the parent object
     * @param obj
     * @returns {setBelongsTo}
     */
    function setBelongsTo (obj) {
        parent = obj;
        return this;
    }

    /**
     * Sets fill color of the path
     * @param fill
     */
    function setFill(fill) {
        if(fill.substring(0,4) == 'rgba'){
            properties.fillStyle = fill;
        } else{
            fill = 'rgba'+fill.substring(3,fill.length-1)+',0.5)';
            properties.fillStyle = fill;
        }
        return this;
    }

    function setFillStyle (fill) {
        // This method sets the fillStyle of the path
        if(fill!=undefined){
            properties.fillStyle = fill;
        }
        return this;
    }

    /**
     * This method sets the line width.
     * @param lineWidth {number} Line width
     * @returns {setLineWidth}
     */
    function setLineWidth (lineWidth) {
        if(!isNaN(lineWidth)){
            properties.lineWidth  = '' + lineWidth;
        }
        return this;
    }

    /**
     * This method sets the strokeStyle of the path
     * @param stroke {string} Stroke style
     * @returns {setStrokeStyle}
     */
    function setStrokeStyle (stroke) {
        properties.strokeStyle = stroke;
        return this;
    }

    /**
     * This method sets the visibility of a path
     * @param visibility {string} Visibility (visible or hidden)
     * @returns {setVisibility}
     */
    function setVisibility (visibility) {
        if (visibility === 'visible' || visibility === 'hidden') status.visibility = visibility;
        return this;
    }

    self.belongsTo = belongsTo;
    self.getBoundingBox = getBoundingBox;
    self.getLineWidth = getLineWidth;
    self.getFill = getFill;
    self.getSvImageBoundingBox = getSvImageBoundingBox;
    self.getImageCoordinates = getImageCoordinates;
    self.getPoints = getPoints;
    self.getProperty = getProperty;
    self.getStatus = getStatus;
    self.isOn = isOn;
    self.overlap = overlap;
    self.removePoints = removePoints;
    self.render2 = render2;
    self.render = render;
    self.renderBoundingBox = renderBoundingBox;
    self.resetFillStyle = resetFillStyle;
    self.resetStrokeStyle = resetStrokeStyle;
    self.setFill = setFill;
    self.setBelongsTo = setBelongsTo;
    self.setLineWidth = setLineWidth;
    self.setFillStyle = setFillStyle;
    self.setStrokeStyle = setStrokeStyle;
    self.setVisibility = setVisibility;

    // Initialize
    _init(points, params);

    return self;
}

/**
 * Point object
 *
 * @param x x-coordinate of the point on a canvas
 * @param y y-coordinate of the point on a canvas
 * @param pov Point of view that looks like
 * @param params
 * @returns {{className: string, svImageCoordinate: undefined, canvasCoordinate: undefined, originalCanvasCoordinate: undefined, pov: undefined, originalPov: undefined}}
 * @constructor
 * @memberof svl
 */
function Point (x, y, pov, params) {
  'use strict';

    if(params.fillStyle==undefined){
        params.fillStyle = 'rgba(255,255,255,0.5)';
    }
    var self = {
            className : 'Point',
            svImageCoordinate : undefined,
            canvasCoordinate : undefined,
            originalCanvasCoordinate : undefined,
            pov : undefined,
            originalPov : undefined
        };
    var belongsTo;
    var properties = {
        fillStyleInnerCircle: params.fillStyle,
        lineWidthOuterCircle: 2,
        iconImagePath: undefined,
        originalFillStyleInnerCircle: undefined,
        originalStrokeStyleOuterCircle: undefined,
        radiusInnerCircle: 4,
        radiusOuterCircle: 5,
        strokeStyleOuterCircle: 'rgba(255,255,255,1)',
        storedInDatabase: false
    };
    var unnessesaryProperties = ['originalFillStyleInnerCircle', 'originalStrokeStyleOuterCircle'];
    var status = {
            'deleted' : false,
            'visibility' : 'visible',
            'visibilityIcon' : 'visible'
    };

    function _init (x, y, pov, params) {
        // Convert a canvas coordinate (x, y) into a sv image coordinate
        // Note, svImageCoordinate.x varies from 0 to svImageWidth and
        // svImageCoordinate.y varies from -(svImageHeight/2) to svImageHeight/2.
        
        // Adjust the zoom level
        var zoom = pov.zoom;
        var zoomFactor = svl.zoomFactor[zoom];
        var svImageHeight = svl.svImageHeight;
        var svImageWidth = svl.svImageWidth;
        self.svImageCoordinate = {};
        self.svImageCoordinate.x = svImageWidth * pov.heading / 360 + (svl.alpha_x * (x - (svl.canvasWidth / 2)) / zoomFactor);
        self.svImageCoordinate.y = (svImageHeight / 2) * pov.pitch / 90 + (svl.alpha_y * (y - (svl.canvasHeight / 2)) / zoomFactor);
        // svImageCoordinate.x could be negative, so adjust it.
        if (self.svImageCoordinate.x < 0) {
            self.svImageCoordinate.x = self.svImageCoordinate.x + svImageWidth;
        }
        // Keep the original canvas coordinate and
        // canvas pov just in case.
        self.canvasCoordinate = {
            x : x,
            y : y
        };
        self.originalCanvasCoordinate = {
            x : x,
            y : y
        };
        self.pov = {
            heading : pov.heading,
            pitch : pov.pitch,
            zoom : pov.zoom
        };
        self.originalPov = {
            heading : pov.heading,
            pitch : pov.pitch,
            zoom : pov.zoom
        };

        // Set properties
        for (var propName in properties) {
            // It is ok if iconImagePath is not specified
            if(propName === "iconImagePath") {
                if (params.iconImagePath) {
                    properties.iconImagePath = params.iconImagePath;
                } else {
                    continue;
                }
            }

            if (propName in params) {
                properties[propName] = params[propName];
            } else {
                // See if this property must be set.
                if (unnessesaryProperties.indexOf(propName) === -1) {
                    // throw self.className + ': "' + propName + '" is not defined.';
                }
            }
        }

        properties.originalFillStyleInnerCircle = properties.fillStyleInnerCircle;
        properties.originalStrokeStyleOuterCircle = properties.strokeStyleOuterCircle;
        return true;
    }


    /** Deprecated */
    function _init2 () { return true; }

    /** Get x canvas coordinate */
    function getCanvasX () { return self.canvasCoordinate.x; }

    /** Get y canvas coordinate */
    function getCanvasY () { return self.canvasCoordinate.y; }

    /** return the fill color of this point */
    function getFill () { return properties.fillStyleInnerCircle; }

    /** Get POV */
    function getPOV () { return pov; }

    /** Returns an object directly above this object. */
    function getParent () { return belongsTo ? belongsTo : null; }


    /**
     * This function takes current pov of the Street View as a parameter and returns a canvas coordinate of a point.
     * @param pov
     * @returns {{x, y}}
     */
    function getCanvasCoordinate (pov) {
        self.canvasCoordinate = svl.gsvImageCoordinate2CanvasCoordinate(self.svImageCoordinate.x, self.svImageCoordinate.y, pov);
        return svl.gsvImageCoordinate2CanvasCoordinate(self.svImageCoordinate.x, self.svImageCoordinate.y, pov);
    }

    /**
     * Get the fill style.
     * @returns {*}
     */
    function getFillStyle () { return  getFill(); }

    function getGSVImageCoordinate () { return $.extend(true, {}, self.svImageCoordinate); }

    function getProperty (name) { return (name in properties) ? properties[name] : null; }

    function getProperties () { return $.extend(true, {}, properties); }

    function isOn (x, y) {
        var margin = properties.radiusOuterCircle / 2 + 3;
        if (x < self.canvasCoordinate.x + margin &&
            x > self.canvasCoordinate.x - margin &&
            y < self.canvasCoordinate.y + margin &&
            y > self.canvasCoordinate.y - margin) {
            return this;
        } else {
            return false;
        }
    }

    /**
     * Renders this point
     * @param pov
     * @param ctx
     */
    function render (pov, ctx) {
        if (status.visibility === 'visible') {
            var coord = self.getCanvasCoordinate(pov),
                x = coord.x,
                y = coord.y,
                r = properties.radiusInnerCircle;

            ctx.save();
            ctx.strokeStyle = properties.strokeStyleOuterCircle;
            ctx.lineWidth = properties.lineWidthOuterCircle;
            ctx.beginPath();
            ctx.arc(x, y, properties.radiusOuterCircle, 2 * Math.PI, 0, true);
            ctx.closePath();
            ctx.stroke();
            ctx.fillStyle = properties.fillStyleInnerCircle; // changeAlphaRGBA(properties.fillStyleInnerCircle, 0.5);
            ctx.beginPath();
            ctx.arc(x, y, properties.radiusInnerCircle, 2 * Math.PI, 0, true);
            ctx.closePath();
            ctx.fill();

            // Render an icon
            var imagePath = getProperty("iconImagePath");
            if (imagePath) {
                var imageObj, imageHeight, imageWidth, imageX, imageY;
                imageObj = new Image();
                imageHeight = imageWidth = 2 * r - 3;
                imageX =  x - r + 2;
                imageY = y - r + 2;

                //ctx.globalAlpha = 0.5;
                imageObj.src = imagePath;

                try {
                    ctx.drawImage(imageObj, imageX, imageY, imageHeight, imageWidth);
                } catch (e) {
                    // console.debug(e);
                }

                //ctx.drawImage(imageObj, imageX, imageY, imageHeight, imageWidth);
            }
            ctx.restore();
        }
    }

    /**
     * This method reverts the fillStyle property to its original value
     * @returns {resetFillStyle}
     */
    function resetFillStyle () {
        properties.fillStyleInnerCircle = properties.originalFillStyleInnerCircle;
        return this;
    }

    /**
     * Set the svImageCoordinate
     * @param coord
     * @returns {self}
     */
    function resetSVImageCoordinate (coord) {
        self.svImageCoordinate = coord;
        self.canvasCoordinate = {x : 0, y: 0};
        return this;
    }

    /**
     * This method resets the strokeStyle to its original value
     * @returns {self}
     */
    function resetStrokeStyle () {
        properties.strokeStyleOuterCircle = properties.originalStrokeStyleOuterCircle;
        return this;
    }

    /**
     * This function sets which object (Path)
     * @param obj
     * @returns {self}
     */
    function setBelongsTo (obj) {
        belongsTo = obj;
        return this;
    }

    /**
     * This method sets the fill style of inner circle to the specified value
     * @param value
     * @returns {self}
     */
    function setFillStyle (value) {
        properties.fillStyleInnerCircle = value;
        return this;
    }

    function setIconPath (iconPath) {
        properties.iconImagePath = iconPath;
        return this;
    }

    /**
     * this method sets the photographerHeading and photographerPitch
     * @param heading
     * @param pitch
     * @returns {self}
     */
    function setPhotographerPov (heading, pitch) {
        properties.photographerHeading = heading;
        properties.photographerPitch = pitch;
        return this;
    }

    /**
     * This function resets all the properties specified in params.
     * @param params
     * @returns {self}
     */
    function setProperties (params) {
        for (var key in params) {
            if (key in properties) {
                properties[key] = params[key];
            }
        }

        if ('originalCanvasCoordinate' in params) {
            self.originalCanvasCoordinate = params.originalCanvasCoordinate;
        }

        //
        // Set pov parameters
        self.pov = self.pov || {};
        if ('pov' in params) { self.pov = params.pov; }
        if ('heading' in params) { self.pov.heading = params.heading; }
        if ('pitch' in params) { self.pov.pitch = params.pitch; }
        if ('zoom' in params) { self.pov.zoom = params.zoom; }

        // Set original pov parameters
        self.originalPov = self.originalPov || {};
        if ('originalHeading' in params) { self.originalPov.heading = params.originalHeading; }
        if ('originalPitch' in params) { self.originalPov.pitch = params.originalPitch; }
        if ('originalZoom' in params) { self.originalPov.zoom = params.originalZoom; }

        if (!properties.originalFillStyleInnerCircle) {
            properties.originalFillStyleInnerCircle = properties.fillStyleInnerCircle;
        }
        if (!properties.originalStrokeStyleOuterCircle) {
            properties.originalStrokeStyleOuterCircle = properties.strokeStyleOuterCircle;
        }
        return this;
    }

    function setStrokeStyle (val) {
        // This method sets the strokeStyle of an outer circle to val
        properties.strokeStyleOuterCircle = val;
        return this;
    }

    self.belongsTo = getParent;
    self.getPOV = getPOV;
    self.getCanvasCoordinate = getCanvasCoordinate;
    self.getCanvasX = getCanvasX;
    self.getCanvasY = getCanvasY;
    self.getFill = getFill;
    self.getFillStyle = getFillStyle;
    self.getGSVImageCoordinate = getGSVImageCoordinate;
    self.getProperty = getProperty;
    self.getProperties = getProperties;
    self.isOn = isOn;
    self.render = render;
    self.resetFillStyle = resetFillStyle;
    self.resetSVImageCoordinate = resetSVImageCoordinate;
    self.resetStrokeStyle = resetStrokeStyle;
    self.setBelongsTo = setBelongsTo;
    self.setFillStyle = setFillStyle;
    self.setIconPath = setIconPath;
    self.setPhotographerPov = setPhotographerPov;
    self.setProperties = setProperties;
    self.setStrokeStyle = setStrokeStyle;
    self.setVisibility = setVisibility;

    function setVisibility (visibility) {
        // This method sets the visibility of a path (and points that cons
        if (visibility === 'visible' || visibility === 'hidden') {
            status.visibility = visibility;
        }
        return this;
    }

    // Todo. Deprecated method. Get rid of this later.
    self.resetProperties = self.setProperties;

  var argLen = arguments.length;
    if (argLen === 4) {
        _init(x, y, pov, params);
    } else {
        _init2();
    }

    return self;
}


svl.gsvImageCoordinate2CanvasCoordinate = function (xIn, yIn, pov) {
    // This function takes the current pov of the Street View as a parameter
    // and returns a canvas coordinate of a point (xIn, yIn).
    var x, y, zoom = pov.zoom;
    var svImageWidth = svl.svImageWidth * svl.zoomFactor[zoom];
    var svImageHeight = svl.svImageHeight * svl.zoomFactor[zoom];

    xIn = xIn * svl.zoomFactor[zoom];
    yIn = yIn * svl.zoomFactor[zoom];

    x = xIn - (svImageWidth * pov.heading) / 360;
    x = x / svl.alpha_x + svl.canvasWidth / 2;

    //
    // When POV is near 0 or near 360, points near the two vertical edges of
    // the SV image does not appear. Adjust accordingly.
    var edgeOfSvImageThresh = 360 * svl.alpha_x * (svl.canvasWidth / 2) / (svImageWidth) + 10;

    if (pov.heading < edgeOfSvImageThresh) {
        // Update the canvas coordinate of the point if
        // its svImageCoordinate.x is larger than svImageWidth - alpha_x * (svl.canvasWidth / 2).
        if (svImageWidth - svl.alpha_x * (svl.canvasWidth / 2) < xIn) {
            x = (xIn - svImageWidth) - (svImageWidth * pov.heading) / 360;
            x = x / svl.alpha_x + svl.canvasWidth / 2;
        }
    } else if (pov.heading > 360 - edgeOfSvImageThresh) {
        if (svl.alpha_x * (svl.canvasWidth / 2) > xIn) {
            x = (xIn + svImageWidth) - (svImageWidth * pov.heading) / 360;
            x = x / svl.alpha_x + svl.canvasWidth / 2;
        }
    }

    y = yIn - (svImageHeight / 2) * (pov.pitch / 90);
    y = y / svl.alpha_y + svl.canvasHeight / 2;

    return {x : x, y : y};
};

svl.zoomFactor = {
    1: 1,
    2: 2.1,
    3: 4,
    4: 8,
    5: 16
};

/**
 * Neighborhood module.
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Neighborhood (parameters) {
    var self = { className: "Neighborhood"},
        properties = {
            layer: null,
            regionId: null
        },
        status = {
            layerAdded: false
        };

    /**
     * Initialize
     */
    function _init (parameters) {
        if ('regionId' in parameters) {
            setProperty("regionId", parameters.regionId);
            self.regionId = parameters.regionId;  // for debugging
        }
        if ("layer" in parameters) setProperty("layer", parameters.layer);
    }

    /**
     * Add a layer to the map
     * @param map
     */
    function addTo(map, layerStyle) {
        if (map && properties.layer && !status.layerAdded) {
            layerStyle = { color: "rgb(161,217,155)", opacity: 0.5, fillColor: "rgb(255,255,255)", fillOpacity: 0.5, weight: 0 } || layerStyle;
            status.layerAdded = true;
            properties.layer.addTo(map);
            properties.layer.setStyle(layerStyle);
        }
    }

    /**
     * Return the center of this polygon
     * @returns {null}
     */
    function center () {
        return properties.layer ? turf.center(parameters.layer.toGeoJSON()) : null;
    }
    
    function completedLineDistance (unit) {
        if (!unit) unit = "kilometers";
        if ("taskContainer" in svl && svl.taskContainer) {
            return svl.taskContainer.getCompletedTaskDistance(getProperty("regionId"), unit);
        } else {
            return null;
        }
        
    }

    /** Get property */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /** Set property */
    function setProperty (key, value) {
        properties[key] = value;
        return this;
    }

    function totalLineDistanceInARegion (unit) {
        if (!unit) unit = "kilometers";
        if ("taskContainer" in svl && svl.taskContainer) {
            return svl.taskContainer.totalLineDistanceInARegion(getProperty("regionId"), unit);
        } else {
            return null;
        }
    }

    _init(parameters);

    self.addTo = addTo;
    self.center = center;
    self.completedLineDistance = completedLineDistance;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    self.totalLineDistance = totalLineDistanceInARegion;
    return self;
}
/**
 * NeighborhoodContainer module
 * @param parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function NeighborhoodContainer (parameters) {
    var self = { className: "NeighborhoodContainer" },
        neighborhoods = {},
        status = {
            currentNeighborhood: null
        };

    function _init (parameters) {
        parameters = parameters || {};
        if ("currentNeighborhood" in parameters) {
            setStatus("currentNeighborhood", parameters.currentNeighborhood);
        }
    }


    /** Add the given neighborhood to the container */
    function add(neighborhood) {
        var id = neighborhood.getProperty("regionId");
        neighborhoods[id] = neighborhood;
    }

    /** Get a neighborhood instance of the given id */
    function get (id) {
        return id in neighborhoods ? neighborhoods[id] : null;
    }

    function getCurrentNeighborhood () {
        return getStatus("currentNeighborhood");
    }

    /** Return a list of neighborhood ids */
    function getRegionIds () {
        return Object.keys(neighborhoods).map(function (x) { return parseInt(x, 10); });
    }

    function getStatus (key) {
        return status[key];
    }

    function setCurrentNeighborhood (neighborhood) {
        setStatus("currentNeighborhood", neighborhood);
    }

    /**
     * Set the status
     * @param key
     * @param value
     */
    function setStatus (key, value) {
        status[key] = value;
        
        if (key == "currentNeighborhood" && "neighborhoodStatus" in svl && svl.neighborhoodStatus &&
        typeof value == "object" && "className" in value && value.className == "Neighborhood") {
            var href = "/contribution/" + svl.user.getProperty("username") + "?regionId=" + value.getProperty("regionId");
            svl.neighborhoodStatus.setHref(href)
        }
    }


    _init(parameters);

    self.add = add;
    self.get = get;
    self.getCurrentNeighborhood = getCurrentNeighborhood;
    self.getRegionIds = getRegionIds;
    self.getStatus = getStatus;
    self.setCurrentNeighborhood = setCurrentNeighborhood;
    self.setStatus = setStatus;

    return self;
}
/**
 * Neighborhood factory module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function NeighborhoodFactory () {
    var self = { className: "NeighborhoodFactory" };

    /**
     * Create a neighborhood instance.
     * @param regionId
     * @param layer Leaflet layer
     * @returns {Neighborhood}
     */
    function create (regionId, layer) {
        return new Neighborhood({regionId: regionId, layer: layer});
    }

    self.create = create;
    return self;
}
function Panorama(data) {
    var self = { className: "Panorama" },
        _data = data,
        properties = { submitted: false };

    function getData () {
        return _data;
    }

    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    function setProperty (key, value) {
        properties[key] = value;
    }

    self.data = getData;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    return self;
}
function PanoramaContainer (google) {
    var self = { className: "PanoramaContainer" },
        container = {};

    /**
     * This method adds panorama data into the container
     * @param panoramaId
     * @param panorama
     */
    function add(panoramaId, panorama) {
        if (!(panoramaId in container)) {
            container[panoramaId] = panorama;
        }
    }

    /**
     * This method returns the existing panorama data
     * @param panoramaId
     * @returns {null}
     */
    function getPanorama (panoramaId) {
        return panoramaId in container ? container[panoramaId] : null;
    }

    /**
     * Get all the panorama instances stored in the container
     * @returns {Array}
     */
    function getPanoramas () {
        return Object.keys(container).map(function (panoramaId) { return container[panoramaId]; });
    }

    /**
     * Get panorama instances that have not been submitted to the server
     * @returns {Array}
     */
    function getStagedPanoramas () {
        var panoramas = getPanoramas();
        panoramas = panoramas.filter(function (pano) { return !pano.getProperty("submitted"); });
        return panoramas;
    }

    /**
     * Street View Service https://developers.google.com/maps/documentation/javascript/streetview#StreetViewServiceResponses
     */
    function processSVData (data, status) {
        if (status === google.maps.StreetViewStatus.OK) {
            if ("location" in data && "pano" in data.location) {
                add(data.location.pano, new Panorama(data))
            }
        }
    }

    /**
     * Request the panorama meta data.
     */
    function fetchPanoramaMetaData (panoramaId) {
        if ("streetViewService") {
            svl.streetViewService.getPanorama({ pano: panoramaId }, processSVData);
        } else {
            console.error("Street View Service not loaded")
        }
    }

    self.getPanorama = getPanorama;
    self.getPanoramas = getPanoramas;
    self.getStagedPanoramas = getStagedPanoramas;
    self.fetchPanoramaMetaData = fetchPanoramaMetaData;
    return self;
}


/**
 * Label Counter module. 
 * @param d3 d3 module
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelCounter (d3) {
    var self = {className: 'LabelCounter'};

    var radius = 0.4,
        dR = radius / 2,
        svgWidth = 200,
        svgHeight = 120,
        margin = {top: 10, right: 10, bottom: 10, left: 0},
        padding = {left: 5, top: 15},
        width = 200 - margin.left - margin.right,
        height = 40 - margin.top - margin.bottom,
        colorScheme = svl.misc.getLabelColors(),
        imageWidth = 22,
        imageHeight = 22;

    // Prepare a group to store svg elements, and declare a text
    var dotPlots = {
      "CurbRamp": {
        id: "CurbRamp",
        description: "curb ramp",
        left: margin.left,
        top: margin.top,
        fillColor: colorScheme["CurbRamp"].fillStyle,
          imagePath: svl.rootDirectory + "/img/icons/Sidewalk/Icon_CurbRamp.png",
        count: 0,
        data: []
      },
      "NoCurbRamp": {
          id: "NoCurbRamp",
          description: "missing curb ramp",
          left: margin.left + width / 2,
          top: margin.top,
          // top: 2 * margin.top + margin.bottom + height,
          fillColor: colorScheme["NoCurbRamp"].fillStyle,
          imagePath: svl.rootDirectory + "/img/icons/Sidewalk/Icon_NoCurbRamp.png",
          count: 0,
          data: []
      },
      "Obstacle": {
        id: "Obstacle",
        description: "obstacle",
        left: margin.left,
        // top: 3 * margin.top + 2 * margin.bottom + 2 * height,
          top: 2 * margin.top + margin.bottom + height,
        fillColor: colorScheme["Obstacle"].fillStyle,
          imagePath: svl.rootDirectory + "/img/icons/Sidewalk/Icon_Obstacle.png",
        count: 0,
        data: []
      },
      "SurfaceProblem": {
        id: "SurfaceProblem",
        description: "surface problem",
        left: margin.left + width / 2,
        //top: 4 * margin.top + 3 * margin.bottom + 3 * height,
          top: 2 * margin.top + margin.bottom + height,
        fillColor: colorScheme["SurfaceProblem"].fillStyle,
          imagePath: svl.rootDirectory + "/img/icons/Sidewalk/Icon_SurfaceProblem.png",
        count: 0,
        data: []
      },
        "Other": {
            id: "Other",
            description: "other",
            left: margin.left,
            top: 3 * margin.top + 2 * margin.bottom + 2 * height,
            fillColor: colorScheme["Other"].fillStyle,
            imagePath: svl.rootDirectory + "/img/icons/Sidewalk/Icon_Other.png",
            count: 0,
            data: []
        }
    };

    var keys = Object.keys(dotPlots);

    var x = d3.scale.linear()
              .domain([0, 20])
              .range([0, width]);

    var y = d3.scale.linear()
            .domain([0, 20])
            .range([height, 0]);

    var svg = d3.select('#label-counter')
                  .append('svg')
                  .attr('width', svgWidth)
                  .attr('height', svgHeight);

    var chart = svg.append('g')
                  .attr('width', svgWidth)
                  .attr('height', svgHeight)
                  .attr('class', 'chart')
                  .attr('transform', function () {
                     return 'translate(0,0)';
                  });

    for (var key in dotPlots) {
        dotPlots[key].g = chart.append('g')
                    .attr('transform', 'translate(' + dotPlots[key].left + ',' + dotPlots[key].top + ')')
                    .attr('width', width)
                    .attr('height', height)
                    .attr('class', 'main');

        dotPlots[key].label = dotPlots[key].g.selectAll("text.label")
            .data([0])
            .enter()
            .append("text")
            .text(function () {
                var ret = dotPlots[key].count + " " + dotPlots[key].description;
                ret += dotPlots[key].count > 1 ? "s" : "";
                return ret;
            })
            .style("font-size", "10px")
            .attr("class", "visible")
            .attr('transform', 'translate(0,' + imageHeight + ')');

        dotPlots[key].plot = dotPlots[key].g.append("g")
            .attr('transform', 'translate(' + (padding.left + imageWidth) + ',' + 0 + ')');

        dotPlots[key].g.append("image")
            .attr("xlink:href", dotPlots[key].imagePath)
            .attr("width", imageWidth)
            .attr("height", imageHeight)
            .attr('transform', 'translate(0,-15)');
    }

    /**
     *
     * @param labelType Label type
     * @returns {integer}
     */
    function countLabel(labelType) {
        return labelType in dotPlots ? dotPlots[labelType].count : null;

    }

    /**
     * Decrement the label count
     * @param key {string} Label type
     */
    function decrement(key) {
        if (keys.indexOf(key) == -1) { key = "Other"; }
        if (key in dotPlots && dotPlots[key].count > 0) {
            dotPlots[key].count -= 1;
        }
        update(key);
    }

    /**
     * Increment the label count
     * @param key {string} Label type
     */
    function increment(key) {
        if (keys.indexOf(key) == -1) { key = "Other"; }
        if (key in dotPlots) {
            dotPlots[key].count += 1;
            update(key);
        }
    }


    /**
     * Set label counts to 0
     */
    function reset () {
        for (var key in dotPlots) {
            set(key, 0);
        }
    }

    /**
     * Set the number of label count
     * @param key {string} Label type
     * @param num {number} Label type count
     */
    function set(key, num) {
        dotPlots[key].count = num;
        update(key);
    }

    /**
     * Update the label count visualization.
     * @param key {string} Label type
     */
    function update(key) {
        // If a key is given, udpate the dot plot for that specific data.
        // Otherwise update all.
        if (key) {
            _update(key)
        } else {
            for (var key in dotPlots) {
                _update(key);
            }
        }

        // Actual update function
        function _update(key) {
            if (keys.indexOf(key) == -1) { key = "Other"; }

            var firstDigit = dotPlots[key].count % 10,
                higherDigits = (dotPlots[key].count - firstDigit) / 10,
                count = firstDigit + higherDigits;


            // Update the dot plot
            if (dotPlots[key].data.length >= count) {
                // Remove dots
                dotPlots[key].data = dotPlots[key].data.slice(0, count);

                dotPlots[key].plot.selectAll("circle")
                    .transition().duration(500)
                    .attr("r", function (d, i) {
                        return i < higherDigits ? x(radius + dR) : x(radius);
                    })
                    .attr("cy", function (d, i) {
                        if (i < higherDigits) {
                            return 0;
                        } else {
                            return x(dR);
                        }
                    });

                dotPlots[key].plot.selectAll("circle")
                    .data(dotPlots[key].data)
                    .exit()
                    .transition()
                    .duration(500)
                    .attr("cx", function () {
                        return x(higherDigits);
                    })
                    .attr("r", 0)
                    .remove();
            } else {
                // Add dots
                var len = dotPlots[key].data.length;
                for (var i = 0; i < count - len; i++) {
                    dotPlots[key].data.push([len + i, 0, radius])
                }
                dotPlots[key].plot.selectAll("circle")
                    .data(dotPlots[key].data)
                    .enter().append("circle")
                    .attr("cx", x(0))
                    .attr("cy", 0)
                    .attr("r", x(radius + dR))
                    .style("fill", dotPlots[key].fillColor)
                    .transition().duration(1000)
                    .attr("cx", function (d, i) {
                        if (i <= higherDigits) {
                            return x(d[0] * 2 * (radius + dR));
                        } else {
                            return x((higherDigits) * 2 * (radius + dR)) + x((i - higherDigits) * 2 * radius)
                        }
                    })
                    .attr("cy", function (d, i) {
                        if (i < higherDigits) {
                            return 0;
                        } else {
                            return x(dR);
                        }
                    })
                    .attr("r", function (d, i) {
                        return i < higherDigits ? x(radius + dR) : x(radius);
                    });
            }
            dotPlots[key].label.text(function () {
                var ret = dotPlots[key].count + " " + dotPlots[key].description;
                ret += dotPlots[key].count > 1 ? "s" : "";
                return ret;
            });
        }
    }


    // Initialize
    update();

    self.increment = increment;
    self.decrement = decrement;
    self.countLabel = countLabel;
    self.set = set;
    self.reset = reset;
    return self;
}
function MissionStatus () {
    var self = { className: "MissionStatus" };

    // These are messages that are shown under the "Current Mission" in the status pane. The object's keys correspond to
    // the "label"s of missions (e.g., "initial-mission"). Substitute __PLACEHOLDER__ depending on each mission.
    var missionMessages = {
        "onboarding": "Complete the onboarding tutorial!",
        "initial-mission": "Walk for 1000ft and find all the sidewalk accessibility attributes",
        "distance-mission": "Walk for __PLACEHOLDER__ and find all the sidewalk accessibility attributes in this neighborhood",
        "area-coverage-mission": "Make the __PLACEHOLDER__ of this neighborhood more accessible"
    };
    
    function _init() {
        printCompletionRate(0);
        
    }

    /**
     * This method returns the mission message based on the passed label parameter.
     * @param label {string} Mission label
     * @returns {string}
     */
    function getMissionMessage(label) {
        return label in missionMessages ? missionMessages[label] : "";
    }

    /**
     * This method prints what percent of the intersection the user has observed.
     * @param completionRate {number} Mission completion rate.
     * @returns {printCompletionRate}
     */
    function printCompletionRate (completionRate) {
        completionRate *= 100;
        if (completionRate > 100) completionRate = 100;
        completionRate = completionRate.toFixed(0, 10);
        completionRate = completionRate + "% complete";
        svl.ui.progressPov.rate.html(completionRate);
        return this;
    }

    /**
     * This method takes a mission object and sets the appropriate text for the mission status field in 
     * the status pane.
     * @param mission
     * @returns {printMissionMessage}
     */
    function printMissionMessage (mission) {
        var missionLabel = mission.getProperty("label"),
            missionMessage = getMissionMessage(missionLabel);

        if (missionLabel == "distance-mission") {
            if (mission.getProperty("level") <= 2) {
                missionMessage = missionMessage.replace("__PLACEHOLDER__", mission.getProperty("distanceFt") + "ft");
            } else {
                missionMessage = missionMessage.replace("__PLACEHOLDER__", mission.getProperty("distanceMi") + "mi");
            }
        } else if (missionLabel == "area-coverage-mission") {
            var coverage = (mission.getProperty("coverage") * 100).toFixed(0) + "%";
            missionMessage = missionMessage.replace("__PLACEHOLDER__", coverage);
        }

        svl.ui.status.currentMissionDescription.html(missionMessage);

        return this;
    }

    /**
     * This method updates the filler of the completion bar
     */
    function updateMissionCompletionBar (completionRate) {
        var r, g, b, color, colorIntensity = 200;
        if (completionRate < 0.6) {
            r = colorIntensity * 1.3;
            g = parseInt(colorIntensity * completionRate * 2);
            b = 20;
        }
        // TODO change green threshold to ~90%
        else {
            r = parseInt(colorIntensity * (1 - completionRate) * 1.7);
            g = colorIntensity;
            b = 100;
        }
        color = 'rgba(' + r + ',' + g + ',' + b + ',1)';
        completionRate *=  100;
        if (completionRate > 100) completionRate = 100;
        completionRate = completionRate.toFixed(0, 10);
        // completionRate -= 0.8;
        completionRate = completionRate + "%";
        svl.ui.progressPov.filler.css({
            background: color,
            width: completionRate
        });
        return this;
    }

    self.printCompletionRate = printCompletionRate;
    self.printMissionMessage = printMissionMessage;
    self.updateMissionCompletionBar = updateMissionCompletionBar;
    
    _init();
    return self;
}

function NeighborhoodStatus () {
    var self = {className: "NeighborhoodStatus"};

    /**
     * Set the href attribute of the link
     * @param hrefString
     */
    function setHref(hrefString) {
        if (svl.ui.status.neighborhoodLink) {
            svl.ui.status.neighborhoodLink.attr("href", hrefString)
        }
    }

    self.setHref = setHref;
    return self;
}
/**
 *
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function StatusField () {
    var self = { className: "StatusField" },
        blinkInterval;

    // Blink the status field
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            svl.ui.status.holder.toggleClass("highlight-50");
        }, 500);
    }

    // Stop blinking
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        svl.ui.status.holder.removeClass("highlight-50");
    }

    self.blink = blink;
    self.stopBlinking = stopBlinking;

    return self;
}
//
// /**
//  * A MissionDescription module
//  * @param $
//  * @param params
//  * @returns {{className: string}}
//  * @constructor
//  * @memberof svl
//  */
// function StatusMessage ($, params) {
//     var self = { className : 'StatusMessage' };
//
//     function _init (params) {    }
//
//     function animate() {
//         svl.ui.statusMessage.holder.removeClass('bounce animated').addClass('bounce animated').one('webkitAnimationEnd mozAnimationEnd MSAnimationEnd oanimationend animationend', function(){
//             $(this).removeClass('bounce animated');
//         });
// //        $('#animationSandbox').removeClass().addClass('bounce animated').one('webkitAnimationEnd mozAnimationEnd MSAnimationEnd oanimationend animationend', function(){
// //              $(this).removeClass();
// //            });
//     }
//
//     function restoreDefault () {
//         setBackgroundColor('rgb(255, 255, 255)');
//         setCurrentStatusDescription('Your mission is to find and label all the accessibility attributes in the sidewalks and streets.');
//         setCurrentStatusTitle('Mission:');
//     }
//     /**
//      *
//      */
//     function setBackgroundColor (rgb) {
//         svl.ui.statusMessage.holder.css('background', rgb);
//     }
//
//     /**
//      * The method sets what's shown in the current status pane in the interface
//      * @param description {string} A string (or html) to put.
//      * @returns {self}
//      */
//     function setCurrentStatusDescription (description) {
//       svl.ui.statusMessage.description.html(description);
//       return this;
//     }
//
//     function setCurrentStatusTitle (title) {
//         svl.ui.statusMessage.title.html(title);
//         return this;
//     }
//
//     self.animate = animate;
//     self.restoreDefault = restoreDefault;
//     self.setBackgroundColor = setBackgroundColor;
//     self.setCurrentStatusDescription = setCurrentStatusDescription;
//     self.setCurrentStatusTitle = setCurrentStatusTitle;
//     _init(params);
//     return self;
// }

/**
 * ModalComment module.
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalComment ($) {
    var self = { className: 'ModalComment'},
        status = {
            disableClickOK: true
        },
        blinkInterval;

    function _init() {
        disableClickOK();
        svl.ui.modalComment.ok.on("click", handleClickOK);
        svl.ui.modalComment.cancel.on("click", handleClickCancel);
        //svl.ui.leftColumn.feedback.on("click", showCommentMenu);
        svl.ui.leftColumn.feedback.on("click", handleClickFeedback);
        svl.ui.modalComment.textarea.on("focus", handleTextareaFocus);
        svl.ui.modalComment.textarea.on("blur", handleTextareaBlur);
        svl.ui.modalComment.textarea.on("input", handleTextareaChange);
    }

    /**
     * Blink the feedback button on the left
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            svl.ui.leftColumn.feedback.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * A callback function for clicking the feedback button on the left
     * @param e
     */
    function handleClickFeedback (e) {
        svl.tracker.push("ModalComment_ClickFeedback");
        showCommentMenu();
    }

    function handleClickOK (e) {
        e.preventDefault();
        svl.tracker.push("ModalComment_ClickOK");
        submitComment();
        hideCommentMenu();
    }

    function handleClickCancel (e) {
        svl.tracker.push("ModalComment_ClickCancel");
        e.preventDefault();
        hideCommentMenu();
    }

    /**
     * Handles changes in the comment field
     */
    function handleTextareaChange () {
        var comment = svl.ui.modalComment.textarea.val();
        if (comment.length > 0) {
            enableClickOK();
        } else {
            disableClickOK();
        }
    }

    function handleTextareaBlur() {
        if ('ribbon' in svl) {
            svl.ribbon.enableModeSwitch();
        }
    }

    function handleTextareaFocus() {
        if ('ribbon' in svl) { svl.ribbon.disableModeSwitch(); }
    }

    function hideCommentMenu () {
        svl.ui.modalComment.holder.addClass('hidden');
    }

    function showCommentMenu () {
        svl.ui.modalComment.textarea.val("");
        svl.ui.modalComment.holder.removeClass('hidden');
        svl.ui.modalComment.ok.addClass("disabled");
        disableClickOK();
    }

    function disableClickOK() {
        svl.ui.modalComment.ok.attr("disabled", true);
        svl.ui.modalComment.ok.addClass("disabled");
        status.disableClickOK = true;
    }

    function enableClickOK () {
        svl.ui.modalComment.ok.attr("disabled", false);
        svl.ui.modalComment.ok.removeClass("disabled");
        status.disableClickOK = false;
    }

    /**
     * Stop blinking the feedback button on the left column
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        svl.ui.leftColumn.feedback.removeClass("highlight-50");
    }

    /**
     * Submit the comment
     */
    function submitComment () {
        if ('task' in svl) {
            var task = svl.taskContainer.getCurrentTask(),
                streetEdgeId = task.getStreetEdgeId(),
                gsvPanoramaId = svl.panorama.getPano(),
                pov = svl.map.getPov(),
                comment = svl.ui.modalComment.textarea.val();

            var latlng = svl.map.getPosition(),
                data = {
                    street_edge_id: streetEdgeId,
                    gsv_panorama_id: gsvPanoramaId,
                    heading: pov ? pov.heading : null,
                    pitch: pov ? pov.pitch : null,
                    zoom: pov ? pov.zoom : null,
                    comment: comment,
                    lat: latlng ? latlng.lat : null,
                    lng: latlng ? latlng.lng : null
                };

            if ("form" in svl && svl.form) {
                svl.form.postJSON("/audit/comment", data)
            }
        }
    }

    _init();

    self.blink = blink;
    self.stopBlinking = stopBlinking;

    return self;
}
/**
 * Modal windows for the examples of accessibility attributes
 * @returns {{className: string}}
 * @constructor
 */
function ModalExample () {
    var self = { className: "ModalExample" };

    function _init () {
        svl.ui.modalExample.close.on("click", handleCloseButtonClick);
        svl.ui.modalExample.background.on("click", handleBackgroundClick);
    }

    function handleBackgroundClick () {
        hide();
    }

    function handleCloseButtonClick () {
        hide();
    }

    function hide () {
        svl.ui.modalExample.curbRamp.addClass("hidden");
        svl.ui.modalExample.noCurbRamp.addClass("hidden");
        svl.ui.modalExample.obstacle.addClass("hidden");
        svl.ui.modalExample.surfaceProblem.addClass("hidden");
    }

    function show (key) {
        hide();
        switch (key) {
            case "CurbRamp":
                svl.ui.modalExample.curbRamp.removeClass("hidden");
                break;
            case "NoCurbRamp":
                svl.ui.modalExample.noCurbRamp.removeClass("hidden");
                break;
            case "Obstacle":
                svl.ui.modalExample.obstacle.removeClass("hidden");
                break;
            case "SurfaceProblem":
                svl.ui.modalExample.surfaceProblem.removeClass("hidden");
                break;
        }
    }

    self.hide = hide;
    self.show = show;

    _init();
    
    return self;
}
/**
 * ModalMission module
 * @param $ jQuery object
 * @param L Leaflet object
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalMission ($, L) {
    var self = { className : 'ModalMission'},
        properties = {
            boxTop: 180,
            boxLeft: 45,
            boxWidth: 640
        };

    // Mission titles. Keys are mission labels.
    var missionTitles = {
        "initial-mission": "Initial Mission",
        "distance-mission": "Mission: Make __PLACEHOLDER__ of this neighborhood accessible",
        "coverage-mission": "Mission: Make __PLACEHOLDER__ of this neighborhood accessible"
    };
    
    function _init () {
        svl.ui.modalMission.background.on("click", handleBackgroundClick);
        svl.ui.modalMission.closeButton.on("click", handleCloseButtonClick);
    }

    /**
     * Get a property
     * @param key
     * @returns {null}
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Callback function for background click
     * @param e
     */
    function handleBackgroundClick(e) {
        hideMission();
    }

    /**
     * Callback function for button click
     * @param e
     */
    function handleCloseButtonClick(e) {
        hideMission();
    }

    /**
     * Hide a mission
     */
    function hideMission () {
        svl.ui.modalMission.holder.css('visibility', 'hidden');
        svl.ui.modalMission.foreground.css('visibility', 'hidden');
        svl.ui.modalMission.background.css('visibility', 'hidden');
    }

    /** Show a mission */
    function showMissionModal () {
        svl.ui.modalMission.holder.css('visibility', 'visible');
        svl.ui.modalMission.foreground.css('visibility', 'visible');
        svl.ui.modalMission.background.css('visibility', 'visible');
    }

    /**
     * Set the mission message in the modal window, then show the modal window.
     * @param mission String The type of the mission. It could be one of "initial-mission" and "area-coverage".
     * @param parameters Object
     */
    function setMissionMessage (mission, parameters) {
        // Set the title and the instruction of this mission.
        var label = mission.getProperty("label"),
            templateHTML = $("template.missions[val='" + label + "']").html(),
            missionTitle = label in missionTitles ? missionTitles[label] : "Mission";


        if (label == "distance-mission") {
            // Set the title
            var distanceString;
            if (mission.getProperty("level") <= 2) {
                missionTitle = missionTitle.replace("__PLACEHOLDER__", mission.getProperty("distanceFt") + "ft");
                distanceString = mission.getProperty("distanceFt") + "ft";
            } else {
                missionTitle = missionTitle.replace("__PLACEHOLDER__", mission.getProperty("distanceMi") + "mi");
                distanceString = mission.getProperty("distanceMi") + "mi";
            }
            svl.ui.modalMission.missionTitle.html(missionTitle);

            // Set the instruction
            svl.ui.modalMission.instruction.html(templateHTML);
            $("#mission-target-distance").html(distanceString);
        } else if (label == "area-coverage-mission") {
            // Set the title
            var coverage = (mission.getProperty("coverage") * 100).toFixed(0) + "%";
            missionTitle = missionTitle.replace("__PLACEHOLDER__", coverage);
            svl.ui.modalMission.missionTitle.html(missionTitle);

            svl.ui.modalMission.instruction.html(templateHTML);
            $("#modal-mission-area-coverage-rate").html(coverage);
        } else {
            svl.ui.modalMission.instruction.html(templateHTML);
            svl.ui.modalMission.missionTitle.html(missionTitle);
        }

        var badge = "<img src='" + mission.getProperty("badgeURL") + "' class='img-responsive center-block' alt='badge'/>";
        $("#mission-badge-holder").html(badge);

        if (parameters && "callback" in parameters) {
            $("#modal-mission-holder").find(".ok-button").on("click", parameters.callback);
        } else {
            $("#modal-mission-holder").find(".ok-button").on("click", hideMission);
        }

        showMissionModal();
    }
    

    _init();

    self.setMission = setMissionMessage;  // Todo. Deprecated
    self.setMissionMessage = setMissionMessage;
    self.show = showMissionModal;
    self.showMissionModal = showMissionModal;

    return self;
}

/**
 * ModalMission module
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalMissionComplete ($, d3, L) {
    var self = { className : 'ModalMissionComplete'},
        properties = {
            boxTop: 180,
            boxLeft: 45,
            boxWidth: 640
        };

    // Map visualization
    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';
    var southWest = L.latLng(38.761, -77.262),
        northEast = L.latLng(39.060, -76.830),
        bounds = L.latLngBounds(southWest, northEast),
        map = L.mapbox.map('modal-mission-complete-map', "kotarohara.8e0c6890", {
                maxBounds: bounds,
                maxZoom: 19,
                minZoom: 9
            })
            .fitBounds(bounds);
    var overlayPolygon = {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "geometry": {
            "type": "Polygon", "coordinates": [
                [[-75, 36], [-75, 40], [-80, 40], [-80, 36],[-75, 36]]
            ]}}]};
    var overlayPolygonLayer = L.geoJson(overlayPolygon).addTo(map);
    overlayPolygonLayer.setStyle({ "fillColor": "rgb(255, 255, 255)", "weight": 0 });

    // Bar chart visualization
    // Todo. This can be cleaned up!!!
    var svgCoverageBarWidth = 335,
        svgCoverageBarHeight = 20;
    var svgCoverageBar = d3.select("#modal-mission-complete-complete-bar")
        .append("svg")
        .attr("width", svgCoverageBarWidth)
        .attr("height", svgCoverageBarHeight);

    var gBackground = svgCoverageBar.append("g").attr("class", "g-background");
    var horizontalBarBackground = gBackground.selectAll("rect")
        .data([1])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(240, 240, 240, 1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", svgCoverageBarWidth);

    var gBarChart = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarPreviousContribution = gBarChart.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(23, 55, 94, 1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", 0);
    var horizontalBarPreviousContributionLabel = gBarChart.selectAll("text")
        .data([""])
        .enter().append("text")
        .attr("x", 3)
        .attr("y", 15)
        .attr("dx", 3)
        .attr("fill", "white")
        .attr("font-size", "10pt")
        .text(function (d) {
            return d;
        })
        .style("visibility", "visible");

    var gBarChart2 = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarMission = gBarChart2.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(0,112,192,1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", 0);
    var horizontalBarMissionLabel = gBarChart2.selectAll("text")
        .data([""])
        .enter().append("text")
        .attr("x", 3)
        .attr("y", 15)
        .attr("dx", 3)
        .attr("fill", "white")
        .attr("font-size", "10pt")
        .text(function (d) {
            return d;
        })
        .style("visibility", "visible");


    function _init () {
        svl.ui.modalMissionComplete.background.on("click", handleBackgroundClick);
        svl.ui.modalMissionComplete.closeButton.on("click", handleCloseButtonClick);

        hideMissionComplete();
    }

    function _updateMissionLabelStatistics(curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, otherCount) {
        svl.ui.modalMissionComplete.curbRampCount.html(curbRampCount);
        svl.ui.modalMissionComplete.noCurbRampCount.html(noCurbRampCount);
        svl.ui.modalMissionComplete.obstacleCount.html(obstacleCount);
        svl.ui.modalMissionComplete.surfaceProblemCount.html(surfaceProblemCount);
        svl.ui.modalMissionComplete.otherCount.html(otherCount);
    }

    function _updateMissionProgressStatistics (auditedDistance, missionDistance, remainingDistance, unit) {
        if (!unit) unit = "kilometers";
        svl.ui.modalMissionComplete.totalAuditedDistance.html(auditedDistance.toFixed(2) + " " + unit);
        svl.ui.modalMissionComplete.missionDistance.html(missionDistance.toFixed(2) + " " + unit);
        svl.ui.modalMissionComplete.remainingDistance.html(remainingDistance.toFixed(2) + " " + unit);
    }

    function _updateNeighborhoodStreetSegmentVisualization(missionTasks, completedTasks) {
        // var completedTasks = svl.taskContainer.getCompletedTasks(regionId);
        // var missionTasks = mission.getRoute();

        if (completedTasks && missionTasks) {
            // Add layers http://leafletjs.com/reference.html#map-addlayer
            var i, len, geojsonFeature, layer,
                completedTaskLayerStyle = { color: "rgb(128, 128, 128)", opacity: 1, weight: 3 },
                missionTaskLayerStyle = { color: "rgb(49,130,189)", opacity: 1, weight: 3 };

            // Add the completed task layer
            len = completedTasks.length;
            for (i = 0; i < len; i++) {
                geojsonFeature = completedTasks[i].getFeature();
                layer = L.geoJson(geojsonFeature).addTo(map);
                layer.setStyle(completedTaskLayerStyle);
            }

            // Add the current mission layer
            len = missionTasks.length;
            for (i = 0; i < len; i++) {
                geojsonFeature = missionTasks[i].getFeature();
                layer = L.geoJson(geojsonFeature).addTo(map);
                layer.setStyle(missionTaskLayerStyle);
            }
        }
    }


    /**
     * Update the bar graph visualization
     * @param missionDistanceRate
     * @param auditedDistanceRate
     * @private
     */
    function _updateNeighborhoodDistanceBarGraph(missionDistanceRate, auditedDistanceRate) {
       horizontalBarPreviousContribution.attr("width", 0)
           .transition()
           .delay(200)
           .duration(800)
           .attr("width", auditedDistanceRate * svgCoverageBarWidth);
       horizontalBarPreviousContributionLabel.transition()
           .delay(200)
           .text(parseInt(auditedDistanceRate * 100, 10) + "%");

       horizontalBarMission.attr("width", 0)
           .attr("x", auditedDistanceRate * svgCoverageBarWidth)
           .transition()
           .delay(1000)
           .duration(500)
           .attr("width", missionDistanceRate * svgCoverageBarWidth);
       horizontalBarMissionLabel.attr("x", auditedDistanceRate * svgCoverageBarWidth + 3)
           .transition().delay(1000)
           .text(parseInt(missionDistanceRate * 100, 10) + "%");
    }

    /**
     * Get a property
     * @param key
     * @returns {null}
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Callback function for background click
     * @param e
     */
    function handleBackgroundClick(e) {
        hideMissionComplete();
    }

    /**
     * Callback function for button click
     * @param e
     */
    function handleCloseButtonClick(e) {
        hideMissionComplete();
    }

    /**
     * Hide a mission
     */
    function hideMissionComplete () {
        svl.ui.modalMissionComplete.holder.css('visibility', 'hidden');
        svl.ui.modalMissionComplete.foreground.css('visibility', "hidden");
        svl.ui.modalMissionComplete.map.css('top', 500);
        svl.ui.modalMissionComplete.map.css('left', -500);
        $(".leaflet-clickable").css('visibility', 'hidden');
        $(".leaflet-control-attribution").remove();
    }

    function setMissionTitle (missionTitle) {
        svl.ui.modalMissionComplete.missionTitle.html(missionTitle);
    }

    /** 
     * Show the modal window that presents stats about the completed mission
     */
    function show () {
        svl.ui.modalMissionComplete.holder.css('visibility', 'visible');
        svl.ui.modalMissionComplete.foreground.css('visibility', "visible");
        svl.ui.modalMissionComplete.map.css('top', 0);  // Leaflet map overlaps with the ViewControlLayer
        svl.ui.modalMissionComplete.map.css('left', 0);
        // svl.ui.modalMissionComplete.leafletClickable.css('visibility', 'visible');
        $(".leaflet-clickable").css('visibility', 'visible');


        if ("neighborhoodContainer" in svl && svl.neighborhoodContainer && "missionContainer" in svl && svl.missionContainer) {
            var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood(),
                mission = svl.missionContainer.getCurrentMission();
            if (neighborhood && mission) {
                // Focus on the current region on the Leaflet map
                var center = neighborhood.center();
                neighborhood.addTo(map);
                if (center) {
                    map.setView([center.geometry.coordinates[1], center.geometry.coordinates[0]], 14);
                }

                // Update the horizontal bar chart to show how much distance the user has audited
                var unit = "miles";
                var regionId = neighborhood.getProperty("regionId");
                var auditedDistance = neighborhood.completedLineDistance(unit);
                var remainingDistance = neighborhood.totalLineDistance(unit) - auditedDistance;
                var missionDistance = mission.getProperty("distanceMi");

                var completedTasks = svl.taskContainer.getCompletedTasks(regionId);
                var missionTasks = mission.getRoute();
                var totalLineDistance = svl.taskContainer.totalLineDistanceInARegion(regionId, unit);

                var missionDistanceRate = missionDistance / totalLineDistance;
                var auditedDistanceRate = Math.max(0, auditedDistance / totalLineDistance - missionDistanceRate);

                // var curbRampCount = svl.labelCounter.countLabel("CurbRamp");
                // var noCurbRampCount = svl.labelCounter.countLabel("NoCurbRamp");
                // var obstacleCount = svl.labelCounter.countLabel("Obstacle");
                // var surfaceProblemCount = svl.labelCounter.countLabel("SurfaceProblem");
                // var otherCount = svl.labelCounter.countLabel("Other");
                var labelCount = mission.getLabelCount();
                if (labelCount) {
                    var curbRampCount = labelCount["CurbRamp"];
                    var noCurbRampCount = labelCount["NoCurbRamp"];
                    var obstacleCount = labelCount["Obstacle"];
                    var surfaceProblemCount = labelCount["SurfaceProblem"];
                    var otherCount = labelCount["Other"];
                } else {
                    var curbRampCount = 0;
                    var noCurbRampCount = 0;
                    var obstacleCount = 0;
                    var surfaceProblemCount = 0;
                    var otherCount = 0;
                }


                setMissionTitle(mission.getProperty("label"));
                _updateTheMissionCompleteMessage();
                _updateNeighborhoodDistanceBarGraph(missionDistanceRate, auditedDistanceRate);
                _updateNeighborhoodStreetSegmentVisualization(missionTasks, completedTasks);
                _updateMissionProgressStatistics(auditedDistance, missionDistance, remainingDistance, unit);
                _updateMissionLabelStatistics(curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, otherCount);
            }
        }
    }

    /**
     * This method randomly select a mission completion message from the list and present it to the user.
     * @private
     */
    function _updateTheMissionCompleteMessage() {
        var messages = [
                'Couldn’t have done it better myself.',
                'Aren’t you proud of yourself? We are.',
                'WOWZA. Even the sidewalks are impressed. Keep labeling!',
                'Your auditing is out of this world.',
                'Incredible. You\'re a machine! ...no wait, I am.',
                'Gold star. You can wear it proudly on your forehead all day if you\'d like, we won\'t judge.',
                'Ooh la la! Those accessibility labels are to die for.',
                'We knew you had it in you all along. Great work!',
                'Wow you did really well. You also did good! Kind of like superman.',
                'You\'re one lightning bolt away from being a greek diety. Keep on going!',
                '"Great job. Every accomplishment starts with the decision to try." - That inspirational poster in your office',
                'The [mass x acceleration] is strong with this one. (Physics + Star Wars, get it?)',
                'Hey, check out the reflection in your computer screen. That\'s what awesome looks like.',
                'You. Are. Unstoppable. Keep it up!',
                'Today you are Harry Potter\'s golden snitch. Your wings are made of awesome.',
                'They say unicorns don\'t exist, but hey! We found you. Keep on keepin\' on.',
                '"Uhhhhhhrr Ahhhhrrrrrrrrgggg " Translation: Awesome job! Keep going. - Chewbacca',
                'You\'re seriously talented. You could go pro at this.',
                'Forget Frodo, I would have picked you to take the one ring to Mordor. Great work!',
                'You might actually be a wizard. These sidewalks are better because of you.'
            ],
            message = messages[Math.floor(Math.random() * messages.length)];
        svl.ui.modalMissionComplete.message.html(message);
    }

    _init();

    self.hide = hideMissionComplete;
    self.show = show;
    return self;
}

/**
 * A ModalSkip module
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalSkip ($) {
    var self = { className : 'ModalSkip' },
        status = {
            disableClickOK: true
        },
        blinkInterval;

    function _init () {
        disableClickOK();

        svl.ui.modalSkip.ok.bind("click", handlerClickOK);
        svl.ui.modalSkip.cancel.bind("click", handlerClickCancel);
        svl.ui.modalSkip.radioButtons.bind("click", handlerClickRadio);
        svl.ui.leftColumn.jump.on('click', handleClickJump);
    }

    /**
     * Blink the jump button
     */
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            svl.ui.leftColumn.jump.toggleClass("highlight-50");
        }, 500);
    }

    /**
     * Callback for clicking jump button
     * @param e
     */
    function handleClickJump (e) {
        e.preventDefault();
        svl.tracker.push('ModalSkip_ClickJump');
        svl.modalSkip.showSkipMenu();
    }


    /**
     * This method handles a click OK event
     * @param e
     */
    function handlerClickOK (e) {
        svl.tracker.push("ModalSkip_ClickOK");
        var radioValue = $('input[name="modal-skip-radio"]:checked', '#modal-skip-content').val(),
            position = svl.panorama.getPosition(),
            incomplete = {
                issue_description: radioValue,
                lat: position.lat(),
                lng: position.lng()
            };

        if ('form' in svl) svl.form.skipSubmit(incomplete);
        if ('ribbon' in svl) svl.ribbon.backToWalk();
        hideSkipMenu();
    }

    /**
     * This method handles a click Cancel event
     * @param e
     */
    function handlerClickCancel (e) {
        svl.tracker.push("ModalSkip_ClickCancel");
        hideSkipMenu();
    }

    /**
     * This method takes care of nothing.
     * @param e
     */
    function handlerClickRadio (e) {
        svl.tracker.push("ModalSkip_ClickRadio");
        enableClickOK();
    }

    /**
     * Hide a skip menu
     */
    function hideSkipMenu () {
        svl.ui.modalSkip.radioButtons.prop('checked', false);
        svl.ui.modalSkip.holder.addClass('hidden');
    }

    /**
     * Show a skip menu
     */
    function showSkipMenu () {
        svl.ui.modalSkip.holder.removeClass('hidden');
        disableClickOK();
    }

    /**
     * Disable clicking the ok button
     */
    function disableClickOK () {
        svl.ui.modalSkip.ok.attr("disabled", true);
        svl.ui.modalSkip.ok.addClass("disabled");
        status.disableClickOK = true;
    }

    /**
     * Enable clicking the ok button
     */
    function enableClickOK () {
        svl.ui.modalSkip.ok.attr("disabled", false);
        svl.ui.modalSkip.ok.removeClass("disabled");
        status.disableClickOK = false;
    }

    /**
     * Stop blinking the jump button
     */
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        svl.ui.leftColumn.jump.removeClass("highlight-50");
    }

    _init();

    self.blink = blink;
    self.showSkipMenu = showSkipMenu;
    self.hideSkipMenu = hideSkipMenu;
    self.stopBlinking = stopBlinking;
    return self;
}

var svl = svl || {};
svl.util = svl.util || {};

// A cross-browser function to capture a mouse position
function mouseposition (e, dom) {
    var mx, my;
    //if(e.offsetX) {
        // Chrome
    //    mx = e.offsetX;
    //    my = e.offsetY;
    //} else {
        // Firefox, Safari
        mx = e.pageX - $(dom).offset().left;
        my = e.pageY - $(dom).offset().top;
    //}
    return {'x': parseInt(mx, 10) , 'y': parseInt(my, 10) };
}
svl.util.mouseposition = mouseposition;


// Object prototype
// http://www.smipple.net/snippet/insin/jQuery.fn.disableTextSelection
if (typeof Object.create !== 'function') {
    Object.create = function (o) {
        var F = function () {};
        F.prototype = o;
        return new F();
    };
}

// Trim function
// Based on a code on: http://stackoverflow.com/questions/498970/how-do-i-trim-a-string-in-javascript
if(typeof(String.prototype.trim) === "undefined")
{
    String.prototype.trim = function()
    {
        return String(this).replace(/^\s+|\s+$/g, '');
    };
}

// Default Text
function focusCallback() {
    if ($(this).val() === $(this).attr('title')) {
        /* if the current attribute is the default one, delete it. */
        $(this).val("");
    }
    $(this).removeClass('defaultTextActive');
}

function blurCallback() {
    if(!$(this).val()) {
        /* do following if the field is empty */
        var msg = $(this).attr('title');
        $(this).val( msg );

        $(this).addClass('defaultTextActive');
    }
}

// Based on a snipped posted by Eric Scheid ("ironclad") on November 17, 2000 at:
// http://www.evolt.org/article/Javascript_to_Parse_URLs_in_the_Browser/17/14435/
function getURLParameter(argName) {
    // Get the value of one of the URL parameters.  For example, if this were called
    // with the URL http://your.server.name/foo.html?bar=123 then getURLParameter("bar")
    // would return the string "123".  If the parameter is not found, this will return
    // an empty string, "".

    var argString = location.search.slice(1).split('&');
    var r = '';
    for (var i = 0; i < argString.length; i++) {
        if (argString[i].slice(0,argString[i].indexOf('=')) == argName) {
            r = argString[i].slice(argString[i].indexOf('=')+1);
            break;
        }
    }
    r = (r.length > 0  ? unescape(r).split(',') : '');
    r = (r.length == 1 ? r[0] : '')
    return r;
}
svl.util.getURLParameter = getURLParameter;

// Array Remove - By John Resig (MIT Licensed)
// http://stackoverflow.com/questions/500606/javascript-array-delete-elements
Array.prototype.remove = function(from, to) {
    // var rest = this.slice((to || from) + 1 || this.length);
    var rest = this.slice(parseInt(to || from) + 1 || this.length);
    this.length = from < 0 ? this.length + from : from;
    return this.push.apply(this, rest);
};

// Array min/max
// http://stackoverflow.com/questions/1669190/javascript-min-max-array-values
Array.prototype.max = function() {
    return Math.max.apply(null, this)
};

Array.prototype.min = function() {
    return Math.min.apply(null, this)
};

Array.prototype.sum = function () {
    return this.reduce(function(a, b) { return a + b;});
};

Array.prototype.mean = function () {
    return this.sum() / this.length;
};

/*
 json2.js
 2011-10-19

 Public Domain.

 NO WARRANTY EXPRESSED OR IMPLIED. USE AT YOUR OWN RISK.

 See http://www.JSON.org/js.html
 ...

 Check Douglas Crockford's code for a more recent version of json2.js
 https://github.com/douglascrockford/JSON-js/blob/master/json2.js
 */
if(typeof JSON!=="object"){JSON={}}(function(){"use strict";function f(e){return e<10?"0"+e:e}function quote(e){escapable.lastIndex=0;return escapable.test(e)?'"'+e.replace(escapable,function(e){var t=meta[e];return typeof t==="string"?t:"\\u"+("0000"+e.charCodeAt(0).toString(16)).slice(-4)})+'"':'"'+e+'"'}function str(e,t){var n,r,i,s,o=gap,u,a=t[e];if(a&&typeof a==="object"&&typeof a.toJSON==="function"){a=a.toJSON(e)}if(typeof rep==="function"){a=rep.call(t,e,a)}switch(typeof a){case"string":return quote(a);case"number":return isFinite(a)?String(a):"null";case"boolean":case"null":return String(a);case"object":if(!a){return"null"}gap+=indent;u=[];if(Object.prototype.toString.apply(a)==="[object Array]"){s=a.length;for(n=0;n<s;n+=1){u[n]=str(n,a)||"null"}i=u.length===0?"[]":gap?"[\n"+gap+u.join(",\n"+gap)+"\n"+o+"]":"["+u.join(",")+"]";gap=o;return i}if(rep&&typeof rep==="object"){s=rep.length;for(n=0;n<s;n+=1){if(typeof rep[n]==="string"){r=rep[n];i=str(r,a);if(i){u.push(quote(r)+(gap?": ":":")+i)}}}}else{for(r in a){if(Object.prototype.hasOwnProperty.call(a,r)){i=str(r,a);if(i){u.push(quote(r)+(gap?": ":":")+i)}}}}i=u.length===0?"{}":gap?"{\n"+gap+u.join(",\n"+gap)+"\n"+o+"}":"{"+u.join(",")+"}";gap=o;return i}}if(typeof Date.prototype.toJSON!=="function"){Date.prototype.toJSON=function(e){return isFinite(this.valueOf())?this.getUTCFullYear()+"-"+f(this.getUTCMonth()+1)+"-"+f(this.getUTCDate())+"T"+f(this.getUTCHours())+":"+f(this.getUTCMinutes())+":"+f(this.getUTCSeconds())+"Z":null};String.prototype.toJSON=Number.prototype.toJSON=Boolean.prototype.toJSON=function(e){return this.valueOf()}}var cx=/[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,escapable=/[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,gap,indent,meta={"\b":"\\b","	":"\\t","\n":"\\n","\f":"\\f","\r":"\\r",'"':'\\"',"\\":"\\\\"},rep;if(typeof JSON.stringify!=="function"){JSON.stringify=function(e,t,n){var r;gap="";indent="";if(typeof n==="number"){for(r=0;r<n;r+=1){indent+=" "}}else if(typeof n==="string"){indent=n}rep=t;if(t&&typeof t!=="function"&&(typeof t!=="object"||typeof t.length!=="number")){throw new Error("JSON.stringify")}return str("",{"":e})}}if(typeof JSON.parse!=="function"){JSON.parse=function(text,reviver){function walk(e,t){var n,r,i=e[t];if(i&&typeof i==="object"){for(n in i){if(Object.prototype.hasOwnProperty.call(i,n)){r=walk(i,n);if(r!==undefined){i[n]=r}else{delete i[n]}}}}return reviver.call(e,t,i)}var j;text=String(text);cx.lastIndex=0;if(cx.test(text)){text=text.replace(cx,function(e){return"\\u"+("0000"+e.charCodeAt(0).toString(16)).slice(-4)})}if(/^[\],:{}\s]*$/.test(text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,"@").replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,"]").replace(/(?:^|:|,)(?:\s*\[)+/g,""))){j=eval("("+text+")");return typeof reviver==="function"?walk({"":j},""):j}throw new SyntaxError("JSON.parse")}}})()


// Get what browser the user is using.
// This code was taken from an answer in the following SO page:
// http://stackoverflow.com/questions/3303858/distinguish-chrome-from-safari-using-jquery-browser
var userAgent = navigator.userAgent.toLowerCase();

// Figure out what browser is being used
jQuery.browser = {
    version: (userAgent.match( /.+(?:rv|it|ra|ie|me)[\/: ]([\d.]+)/ ) || [])[1],
    chrome: /chrome/.test( userAgent ),
    safari: /webkit/.test( userAgent ) && !/chrome/.test( userAgent ),
    opera: /opera/.test( userAgent ),
    msie: /msie/.test( userAgent ) && !/opera/.test( userAgent ),
    mozilla: /mozilla/.test( userAgent ) && !/(compatible|webkit)/.test( userAgent )
};

/**
 * This method identifies the type of the user's browser
 *
 * @returns {*}
 */
function getBrowser() {
    // Return a browser name
    var b;
    for (b in $.browser) {
        if($.browser[b] === true) {
            return b;
        }
    }
    return undefined;
}
svl.util.getBrowser = getBrowser;

function getBrowserVersion () {
    // Return a browser version
    return $.browser.version;
}
svl.util.getBrowserVersion = getBrowserVersion;

function getOperatingSystem () {
    var OSName="Unknown OS";
    if (navigator.appVersion.indexOf("Win")!=-1) OSName="Windows";
    if (navigator.appVersion.indexOf("Mac")!=-1) OSName="MacOS";
    if (navigator.appVersion.indexOf("X11")!=-1) OSName="UNIX";
    if (navigator.appVersion.indexOf("Linux")!=-1) OSName="Linux";
    return OSName;
}
svl.util.getOperatingSystem = getOperatingSystem;

/**
 * Given an image coordinate (x, y), return a scaled coordinate. For example, to
 * get the cooresponding coordinate in a smaller 512x256 image, use r = 1/26.
 * @param x
 * @param y
 * @param r
 */
function scaleImageCoordinate(x, y, r) {
    var x_ = x * r;
    var y_ = (3328 - y) * r;
    return {x: x_, y: y_};
}
svl.util.scaleImageCoordinate = scaleImageCoordinate;

function sleep(miliseconds) {
    var end = false;
}

function shuffle(array) {
    // This function returns a shuffled array.
    // Code from http://bost.ocks.org/mike/shuffle/
    var copy = [], n = array.length, i;

    // While there remain elements to shuffle…
    while (n) {

        // Pick a remaining element…
        i = Math.floor(Math.random() * array.length);

        // If not already shuffled, move it to the new array.
        if (i in array) {
            copy.push(array[i]);
            delete array[i];
            n--;
        }
    }

    return copy;
}
svl.util.shuffle = shuffle;


var svl = svl || {};
svl.util = svl.util || {};

/**
 * Color utilities
 * @constructor
 * @memberof svl
 */
function UtilitiesColor () {
    var self = { className: "UtilitiesColor" };

    /**
     * Convert RGB to RGBA
     * @param rgb
     * @param alpha
     * @returns {*}
     * @constructor
     */
    function RGBToRGBA (rgb, alpha) {
        if(!alpha){
            alpha = '0.5';
        }

        var newRGBA;
        if(rgb !== undefined) {
            newRGBA = 'rgba(';
            newRGBA+=rgb.substring(4,rgb.length-1)+','+alpha+')';
        }
        return newRGBA;
    }

    function changeAlphaRGBA(rgba, alpha) {
        // This function updates alpha value of the given rgba value.
        // Ex. if the input is rgba(200,200,200,0.5) and alpha 0.8,
        // the out put will be rgba(200,200,200,0.8)
        var rgbaList = rgba.replace('rgba(','').replace(')','').split(",");
        if (rgbaList.length === 4 && !isNaN(parseInt(alpha))) {
            var newRgba;
            newRgba = 'rgba(' +
                rgbaList[0].trim() + ',' +
                rgbaList[1].trim() + ',' +
                rgbaList[2].trim() + ',' +
                alpha + ')';
            return newRgba;
        } else {
            return rgba;
        }
    }

    function changeDarknessRGBA(rgba, value) {
        // This function takes rgba and value as argumetns
        // rgba: a string such as "rgba(10, 20, 30, 0.5)"
        // value: a value between [0, 1]
        var rgbaList = rgba.replace('rgba(','').replace(')','').split(",");

        if (rgbaList.length === 4) {
            var r;
            var g;
            var b;
            var a;
            var hsvList;
            var newRgbList;
            var newR;
            var newG;
            var newB;
            var newRgba;
            r = parseInt(rgbaList[0].trim());
            g = parseInt(rgbaList[1].trim());
            b = parseInt(rgbaList[2].trim());
            a = rgbaList[3].trim();
            hsvList = rgbToHsv(r,g,b);

            newRgbList = hsvToRgb(hsvList[0],hsvList[1],value);
            newR = parseInt(newRgbList[0]);
            newG = parseInt(newRgbList[1]);
            newB = parseInt(newRgbList[2]);
            newRgba = 'rgba(' + newR + ',' +
                newG + ',' +
                newB + ',' +
                a + ')';
            return newRgba;
        }
        return rgba;
    }

    /**
     * Converts an RGB color value to HSL. Conversion formula
     * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
     * Assumes r, g, and b are contained in the set [0, 255] and
     * returns h, s, and l in the set [0, 1].
     *
     * @param   r       The red color value
     * @param   g       The green color value
     * @param   b       The blue color value
     * @return  Array           The HSL representation
     *
     * http://mjijackson.com/2008/02/rgb-to-hsl-and-rgb-to-hsv-color-model-conversion-algorithms-in-javascript
     */
    function rgbToHsl(r, g, b){
        r /= 255, g /= 255, b /= 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var h, s, l = (max + min) / 2;

        if(max == min){
            h = s = 0; // achromatic
        }else{
            var d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch(max){
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        return [h, s, l];
    }

    /**
     * Converts an HSL color value to RGB. Conversion formula
     * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
     * Assumes h, s, and l are contained in the set [0, 1] and
     * returns r, g, and b in the set [0, 255].
     *
     * @param     h       The hue
     * @param     s       The saturation
     * @param     l       The lightness
     * @return  Array           The RGB representation
     */
    function hslToRgb(h, s, l){
        var r, g, b;

        if(s == 0){
            r = g = b = l; // achromatic
        } else {
            function hue2rgb(p, q, t){
                if(t < 0) t += 1;
                if(t > 1) t -= 1;
                if(t < 1/6) return p + (q - p) * 6 * t;
                if(t < 1/2) return q;
                if(t < 2/3) return p + (q - p) * (2 / 3 - t) * 6;
                return p;
            }

            var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            var p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }

        return [r * 255, g * 255, b * 255];
    }

    /**
     * Converts an RGB color value to HSV. Conversion formula
     * adapted from http://en.wikipedia.org/wiki/HSV_color_space.
     * Assumes r, g, and b are contained in the set [0, 255] and
     * returns h, s, and v in the set [0, 1].
     *
     * @param   Number  r       The red color value
     * @param   Number  g       The green color value
     * @param   Number  b       The blue color value
     * @return  Array           The HSV representation
     */
    function rgbToHsv(r, g, b){
        r = r / 255;
        g = g / 255;
        b = b / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var h, s, v = max;

        var d = max - min;
        s = max === 0 ? 0 : d / max;

        if(max == min){
            h = 0; // achromatic
        }else{
            switch(max){
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        return [h, s, v];
    }

    /**
     * Converts an HSV color value to RGB. Conversion formula
     * adapted from http://en.wikipedia.org/wiki/HSV_color_space.
     * Assumes h, s, and v are contained in the set [0, 1] and
     * returns r, g, and b in the set [0, 255].
     *
     * @param   Number  h       The hue
     * @param   Number  s       The saturation
     * @param   Number  v       The value
     * @return  Array           The RGB representation
     */
    function hsvToRgb(h, s, v){
        var r, g, b;

        var i = Math.floor(h * 6);
        var f = h * 6 - i;
        var p = v * (1 - s);
        var q = v * (1 - f * s);
        var t = v * (1 - (1 - f) * s);

        switch(i % 6){
            case 0: r = v, g = t, b = p; break;
            case 1: r = q, g = v, b = p; break;
            case 2: r = p, g = v, b = t; break;
            case 3: r = p, g = q, b = v; break;
            case 4: r = t, g = p, b = v; break;
            case 5: r = v, g = p, b = q; break;
        }

        return [r * 255, g * 255, b * 255];
    }

    self.RGBToRGBA = RGBToRGBA;
    self.changeAlphaRGBA = changeAlphaRGBA;
    self.changeDarknessRGBA = changeDarknessRGBA;
    self.rgbToHsl = rgbToHsl;
    self.hslToRgb = hslToRgb;
    self.rgbToHsv = rgbToHsv;
    self.hsvToRgb = hsvToRgb;

    return self;
}
svl.util.color = UtilitiesColor();

var svl = svl || {};
svl.util = svl.util || {};
svl.util.math = {}

/**
 * This method takes an angle value in radian and returns a value in degree
 * http://stackoverflow.com/questions/9705123/how-can-i-get-sin-cos-and-tan-to-return-degrees-instead-of-radians
 * @param angleInRadian
 * @returns {number}
 */
function toDegrees (angleInRadian) { return angleInRadian * (180 / Math.PI); }
svl.util.math.toDegrees = toDegrees;

/**
 * This function takes an angle in degree and returns a value in radian
 * http://stackoverflow.com/questions/9705123/how-can-i-get-sin-cos-and-tan-to-return-degrees-instead-of-radians
 * @param angleInDegree
 * @returns {number}
 */
function toRadians (angleInDegree) { return angleInDegree * (Math.PI / 180); }
svl.util.math.toRadians = toRadians;

/**
 * Given a latlng point and a dx and dy (in meters), return a latlng offset (dlng, dlat) .
 * I.e., the new point would be (lng + dlng, lat + dlat)
 * @param lat Current latitude.
 * @param dx Distance along the x-axis
 * @param dy Distance along the y-axis
 */
function latlngOffset(lat, dx, dy) {
    var dlat = dy / 111111;
    var dlng = dx / (111111 * Math.cos(toRadians(lat)));
    return {dlat: dlat, dlng: dlng};
}
svl.util.math.latlngOffset = latlngOffset;

/**
 * given a latlng offset, return offset in distanx along x- and y-axis.
 * @param lat
 * @param dLat
 * @param dLng
 * @returns {{dx: number, dy: number}}
 */
function latlngInverseOffset(lat, dLat, dLng) {
    var dy = 111111 * dLat;
    var dx = 111111 * Math.cos(toRadians(lat)) * dLng;
    return {dx: dx, dy: dy};
}
svl.util.math.latlngInverseOffset = latlngInverseOffset;

/**
 * This function takes two latlon coordinates and returns the angle that forms aroud the z-axis.
 *
 * @param lat1
 * @param lng1
 * @param lat2
 * @param lng2
 * @param relativeToNorth If this is true, then measure it from north and clockwise.
 * @returns {number} An angle in radians
 */
function latLngToAngle (lat1, lng1, lat2, lng2, relativeToNorth) {
    var deltaLat, deltaLng, theta;

    deltaLat = lat2 - lat1;
    deltaLng = lng2 - lng1;
    theta = Math.atan2(deltaLng, deltaLat);

    if (relativeToNorth) {
        theta = Math.PI / 2 - theta;
    }
    return theta;
}
svl.util.math.latLngToAngle = latLngToAngle;


/**
 * This function takes two pairs of latlng positions and returns distance in meters.
 * http://rosettacode.org/wiki/Haversine_formula#JavaScript
 *
 * @param lat1
 * @param lon1
 * @param lat2
 * @param lon2
 * @returns {number} A distance in meters.
 */
function haversine(lat1, lon1, lat2, lon2) {
    //var radians = Array.prototype.map.call(arguments, function(deg) { return deg / 180.0 * Math.PI; });
    //var lat1 = radians[0], lon1 = radians[1], lat2 = radians[2], lon2 = radians[3];
    lat1 = toRadians(lat1);
    lon1 = toRadians(lon1);
    lat2 = toRadians(lat2);
    lon2 = toRadians(lon2);
    var R = 6372800; // m
    var dLat = lat2 - lat1;
    var dLon = lon2 - lon1;
    var a = Math.sin(dLat / 2) * Math.sin(dLat /2) + Math.sin(dLon / 2) * Math.sin(dLon /2) * Math.cos(lat1) * Math.cos(lat2);
    var c = 2 * Math.asin(Math.sqrt(a));
    return R * c;
}
svl.util.math.haversine = haversine;

function distance3d(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    var dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}
svl.util.math.distance3d = distance3d;



// http://clauswitt.com/simple-statistics-in-javascript.html
function Stats(arr) {
    var self = this;
    var theArray = arr || [];

    //http://en.wikipedia.org/wiki/Mean#Arithmetic_mean_.28AM.29
    self.getArithmeticMean = function() {
        var sum = 0, length = theArray.length;
        for(var i=0;i<length;i++) {
            sum += theArray[i];
        }
        return sum/length;
    }

    //http://en.wikipedia.org/wiki/Mean#Geometric_mean_.28GM.29
    self.getGeometricMean = function() {
        var product = 1, length = theArray.length;
        for(var i=0;i<length;i++) {
            product = product * theArray[i];
        }
        return Math.pow(product,(1/length));
    }

    //http://en.wikipedia.org/wiki/Mean#Harmonic_mean_.28HM.29
    self.getHarmonicMean = function() {
        var sum = 0, length = theArray.length;
        for(var i=0;i<length;i++) {
            sum += (1/theArray[i]);
        }
        return length/sum;
    }

    //http://en.wikipedia.org/wiki/Standard_deviation
    self.getStandardDeviation = function() {
        var arithmeticMean = this.getArithmeticMean();
        var sum = 0, length = theArray.length;
        for(var i=0;i<length;i++) {
            sum += Math.pow(theArray[i]-arithmeticMean, 2);
        }
        return Math.pow(sum/length, 0.5);
    }

    // Added by Kotaro
    // http://en.wikipedia.org/wiki/Standard_error
    self.getStandardError = function () {
        var stdev = this.getStandardDeviation();
        var len = theArray.length;
        var stderr = stdev / Math.sqrt(len)
        return stderr;
    };


    //http://en.wikipedia.org/wiki/Median
    self.getMedian = function() {
        var length = theArray.length;
        var middleValueId = Math.floor(length/2);
        var arr = theArray.sort(function(a, b){return a-b;});
        return arr[middleValueId];
    };


    // http://stackoverflow.com/questions/1669190/javascript-min-max-array-values
    self.getMin = function () {
        return Math.min.apply(Math, theArray);
    };


    // Added by Kotaro
    // http://stackoverflow.com/questions/1669190/javascript-min-max-array-values
    self.getMax = function () {
        return Math.max.apply(Math, theArray);
    };


    self.setArray = function(arr) {
        theArray = arr;
        return self;
    }

    self.getArray = function() {
        return theArray;
    }

    return self;
}


/** @namespace */
var svl = svl || {};
svl.util = svl.util || {};
svl.util.shape = {};


function lineWithRoundHead (ctx, x1, y1, r1, x2, y2, r2, sourceFormIn, sourceStrokeStyleIn, sourceFillStyleIn, targetFormIn, targetStrokeStyleIn, targetFillStyleIn) {
    // sourceStyle and targetStyle:
    // - none: do not draw anything
    // - fill: fill the circle
    // - stroke: stroke the circle
    // - both: stroke and fill
    var sourceForm = 'none';
    var targetForm = 'none';
    var sourceStrokeStyle = sourceStrokeStyleIn ? sourceStrokeStyleIn : 'rgba(255,255,255,1)';
    var sourceFillStyle = 'rgba(255,255,255,1)';
    var targetStrokeStyle = 'rgba(255,255,255,1)';
    var targetFillStyle = 'rgba(255,255,255,1)';
    if (sourceFormIn) {
        if (sourceFormIn !== 'none' &&
            sourceFormIn !== 'stroke' &&
            sourceFormIn !== 'fill' &&
            sourceFormIn !== 'both') {
            throw 'lineWithRoundHead(): ' + sourceFormIn + ' is not a valid input.';
        }
        sourceForm = sourceFormIn;
    }
    if (targetFormIn) {
        if (targetFormIn !== 'none' &&
            targetFormIn !== 'stroke' &&
            targetFormIn !== 'fill' &&
            targetFormIn !== 'both') {
            throw 'lineWithRoundHead(): ' + targetFormIn + ' is not a valid input.';
        }
        targetForm = targetFormIn;
    }
    if (sourceStrokeStyleIn) {
        sourceStrokeStyle = sourceStrokeStyleIn;
    }
    if (sourceFillStyleIn) {
        sourceFillStyle = sourceFillStyleIn;
    }
    if (targetStrokeStyleIn) {
        targetStrokeStyle = targetStrokeStyleIn;
    }
    if (targetFillStyleIn) {
        targetFillStyle = targetFillStyleIn;
    }

    var theta = Math.atan2(y2 - y1, x2 - x1);
    var lineXStart = x1 + r1 * Math.cos(theta);
    var lineYStart = y1 + r1 * Math.sin(theta);
    var lineXEnd =  x2 - r2 * Math.cos(theta);
    var lineYEnd = y2 - r2 * Math.sin(theta);

    ctx.save();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lineXStart, lineYStart);
    ctx.lineTo(lineXEnd, lineYEnd);
    ctx.stroke();
    ctx.closePath();
    ctx.restore();

    if (sourceForm !== 'none') {
        ctx.save();
        ctx.fillStyle = sourceFillStyle;
        ctx.strokeStyle = sourceStrokeStyle;
        ctx.beginPath();
        ctx.arc(x1, y1, r1, 0, 2 * Math.PI, true);
        if (sourceForm === 'stroke') {
            ctx.stroke();
        } else if (sourceForm === 'fill') {
            ctx.fill();
        } else if (sourceForm === 'both') {
            ctx.fill();
            ctx.stroke();
        }
        ctx.closePath();
        ctx.restore();
    }
    if (targetForm !== 'none') {
        ctx.save();
        ctx.fillStyle = targetFillStyle;
        ctx.strokeStyle = targetStrokeStyle;
        ctx.beginPath();
        ctx.arc(x2, y2, r2, 0, 2 * Math.PI, true);
        if (targetForm === 'stroke') {
            ctx.stroke();
        } else if (targetForm === 'fill') {
            ctx.fill();
        } else if (targetForm === 'both') {
            ctx.fill();
            ctx.stroke();
        }
        ctx.closePath();
        ctx.restore();
    }
}
svl.util.shape.lineWithRoundHead = lineWithRoundHead;

var svl = svl || {};
svl.misc = svl.misc || {};

function UtilitiesMisc (JSON) {
    var self = { className: "UtilitiesMisc" };

    /**
     *
     * 0 for image y-axis is at *3328*! So the top-left corner of the image is (0, 3328).

     * Note: I realized I wrote the same function in Point.js. (gsvImageCoordinate2CanvasCoordinate()).
     * @param ix
     * @param iy
     * @param pov
     * @param zoomFactor
     * @returns {{x: number, y: number}}
     */
    function imageCoordinateToCanvasCoordinate(ix, iy, pov, zoomFactor) {
        if (!zoomFactor) {
            zoomFactor = 1;
        }

        var canvasX = (ix - svl.svImageWidth * pov.heading / 360) * zoomFactor / svl.alpha_x + svl.canvasWidth / 2;
        var canvasY = (iy - svl.svImageHeight * pov.pitch / 180) * zoomFactor / svl.alpha_y + svl.canvasHeight / 2;
        return {x: canvasX, y: canvasY};
    }

    function canvasCoordinateToImageCoordinate (canvasX, canvasY, pov) {
        var zoomFactor = svl.zoomFactor[pov.zoom];
        var x = svl.svImageWidth * pov.heading / 360 + (svl.alpha_x * (canvasX - (svl.canvasWidth / 2)) / zoomFactor);
        var y = (svl.svImageHeight / 2) * pov.pitch / 90 + (svl.alpha_y * (canvasY - (svl.canvasHeight / 2)) / zoomFactor);
        return { x: x, y: y };
    }

    function getHeadingEstimate(SourceLat, SourceLng, TargetLat, TargetLng) {
        // This function takes a pair of lat/lng coordinates.
        //
        if (typeof SourceLat !== 'number') {
            SourceLat = parseFloat(SourceLat);
        }
        if (typeof SourceLng !== 'number') {
            SourceLng = parseFloat(SourceLng);
        }
        if (typeof TargetLng !== 'number') {
            TargetLng = parseFloat(TargetLng);
        }
        if (typeof TargetLat !== 'number') {
            TargetLat = parseFloat(TargetLat);
        }

        var dLng = TargetLng - SourceLng;
        var dLat = TargetLat - SourceLat;

        if (dLat === 0 || dLng === 0) {
            return 0;
        }

        var angle = toDegrees(Math.atan(dLng / dLat));
        //var angle = toDegrees(Math.atan(dLat / dLng));

        return 90 - angle;
    }

    function getLabelCursorImagePath() {
        return {
            'Walk' : {
                'id' : 'Walk',
                'cursorImagePath' : undefined
            },
            CurbRamp: {
                id: 'CurbRamp',
                cursorImagePath : svl.rootDirectory + 'img/cursors/Cursor_CurbRamp.png'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                cursorImagePath : svl.rootDirectory + 'img/cursors/Cursor_NoCurbRamp.png'
            },
            Obstacle: {
                id: 'Obstacle',
                cursorImagePath : svl.rootDirectory + 'img/cursors/Cursor_Obstacle.png'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                cursorImagePath : svl.rootDirectory + 'img/cursors/Cursor_SurfaceProblem.png'
            },
            Other: {
                id: 'Other',
                cursorImagePath: svl.rootDirectory + 'img/cursors/Cursor_Other.png'
            },
            Occlusion: {
                id: 'Occlusion',
                cursorImagePath: svl.rootDirectory + 'img/cursors/Cursor_Other.png'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                cursorImagePath: svl.rootDirectory + 'img/cursors/Cursor_Other.png'
            }
        }
    }

    // Returns image paths corresponding to each label type.
    function getIconImagePaths(category) {
        var imagePaths = {
            Walk : {
                id : 'Walk',
                iconImagePath : null,
                googleMapsIconImagePath: null
            },
            CurbRamp: {
                id: 'CurbRamp',
                iconImagePath : svl.rootDirectory + 'img/icons/Sidewalk/Icon_CurbRamp.svg',
                googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_CurbRamp.png'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                iconImagePath : svl.rootDirectory + 'img/icons/Sidewalk/Icon_NoCurbRamp.svg',
                googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_NoCurbRamp.png'
            },
            Obstacle: {
                id: 'Obstacle',
                iconImagePath: svl.rootDirectory + 'img/icons/Sidewalk//Icon_Obstacle.svg',
                googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_Obstacle.png'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                iconImagePath: svl.rootDirectory + 'img/icons/Sidewalk/Icon_SurfaceProblem.svg',
                googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_SurfaceProblem.png'
            },
            Other: {
                id: 'Other',
                iconImagePath: svl.rootDirectory + 'img/icons/Sidewalk/Icon_Other.svg',
                googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_Other.png'
            },
            Occlusion: {
                id: 'Occlusion',
                iconImagePath: svl.rootDirectory + 'img/icons/Sidewalk/Icon_Other.svg',
                googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_Other.png'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                iconImagePath: svl.rootDirectory + 'img/icons/Sidewalk/Icon_Other.svg',
                googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_Other.png'
            },
            Void: {
                id: 'Void',
                iconImagePath : null
            }
        };

        return category ? imagePaths[category] : imagePaths;
    }

    function getLabelInstructions () {
        return {
            'Walk' : {
                'id' : 'Walk',
                'instructionalText' : 'Audit the streets and find all the accessibility attributes',
                'textColor' : 'rgba(255,255,255,1)'
            },
            CurbRamp: {
                id: 'CurbRamp',
                instructionalText: 'Locate and label a <span class="underline">curb ramp</span>',
                textColor: 'rgba(255,255,255,1)'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                instructionalText: 'Locate and label a <span class="underline">missing curb ramp</span>',
                textColor: 'rgba(255,255,255,1)'
            },
            Obstacle: {
                id: 'Obstacle',
                instructionalText: 'Locate and label an <span class="underline">obstacle in path</span>',
                textColor: 'rgba(255,255,255,1)'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                instructionalText: 'Locate and label a <span class="underline">surface problem</span>',
                textColor: 'rgba(255,255,255,1)'
            },
            Other: {
                id: 'Other',
                instructionalText: 'Label mode',
                textColor: 'rgba(255,255,255,1)'
            },
            Occlusion: {
                id: 'Occlusion',
                instructionalText: 'Label a <span class="underline">part of sidewalk that cannot be observed</span>',
                textColor: 'rgba(255,255,255,1)'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                instructionalText: 'Label <span class="underline">missing sidewalk</span>',
                textColor: 'rgba(255,255,255,1)'
            }
        }
    }

    /**
     * Todo. This should be moved to RibbonMenu.js
     * @returns {{Walk: {id: string, text: string, labelRibbonConnection: string}, CurbRamp: {id: string, labelRibbonConnection: string}, NoCurbRamp: {id: string, labelRibbonConnection: string}, Obstacle: {id: string, labelRibbonConnection: string}, SurfaceProblem: {id: string, labelRibbonConnection: string}, Other: {id: string, labelRibbonConnection: string}, Occlusion: {id: string, labelRibbonConnection: string}, NoSidewalk: {id: string, labelRibbonConnection: string}}}
     */
    function getRibbonConnectionPositions () {
        return {
            'Walk' : {
                'id' : 'Walk',
                'text' : 'Walk',
                'labelRibbonConnection' : '25px'
            },
            CurbRamp: {
                id: 'CurbRamp',
                labelRibbonConnection: '100px'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                labelRibbonConnection: '174px'
            },
            Obstacle: {
                id: 'Obstacle',
                labelRibbonConnection: '248px'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                labelRibbonConnection: '322px'
            },
            Other: {
                id: 'Other',
                labelRibbonConnection: '396px'
            },
            Occlusion: {
                id: 'Occlusion',
                labelRibbonConnection: '396px'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                labelRibbonConnection: '396px'
            }
        }
    }

    function getLabelDescriptions (category) {
        var descriptions = {
            'Walk' : {
                'id' : 'Walk',
                'text' : 'Walk'
            },
            CurbRamp: {
                id: 'CurbRamp',
                text: 'Curb Ramp'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                text: 'Missing Curb Ramp'
            },
            Obstacle: {
                id: 'Obstacle',
                text: 'Obstacle in Path'
            },
            Other: {
                id: 'Other',
                text: 'Other'
            },
            Occlusion: {
                id: 'Occlusion',
                text: "Can't see the sidewalk"
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                text: 'No Sidewalk'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                text: 'Surface Problem'
            },
            Void: {
                id: 'Void',
                text: 'Void'
            },
            Unclear: {
                id: 'Unclear',
                text: 'Unclear'
            }
        };
        return category ? descriptions[category] : descriptions;
    }

    /**
     * References: Ajax without jQuery.
     * http://stackoverflow.com/questions/8567114/how-to-make-an-ajax-call-without-jquery
     * http://stackoverflow.com/questions/6418220/javascript-send-json-object-with-ajax
     * @param streetEdgeId
     */
    function reportNoStreetView (streetEdgeId) {
        var x = new XMLHttpRequest(), async = true, url = "/audit/nostreetview";
        x.open('POST', url, async);
        x.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        x.send(JSON.stringify({issue: "NoStreetView", street_edge_id: streetEdgeId}));
    }

    self.imageCoordinateToCanvasCoordinate = imageCoordinateToCanvasCoordinate;
    self.canvasCoordinateToImageCoordinate = canvasCoordinateToImageCoordinate;
    self.getHeadingEstimate = getHeadingEstimate;
    self.getLabelCursorImagePath = getLabelCursorImagePath;
    self.getIconImagePaths = getIconImagePaths;
    self.getLabelInstructions = getLabelInstructions;
    self.getRibbonConnectionPositions = getRibbonConnectionPositions;
    self.getLabelDescriptions = getLabelDescriptions;
    self.getLabelColors = ColorScheme.SidewalkColorScheme2;
    self.reportNoStreetView = reportNoStreetView;

    return self;
}

var ColorScheme = (function () {
    function SidewalkColorScheme () {
        return {
            'Walk' : {
                'id' : 'Walk',
                'fillStyle' : 'rgba(0, 0, 0, 0.9)'
            },
            CurbRamp: {
                id: 'CurbRamp',
                fillStyle: 'rgba(0, 244, 38, 0.9)'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                fillStyle: 'rgba(255, 39, 113, 0.9)'
            },
            Obstacle: {
                id: 'Obstacle',
                fillStyle: 'rgba(0, 161, 203, 0.9)'
            },
            Other: {
                id: 'Other',
                fillStyle: 'rgba(204, 204, 204, 0.9)'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                fillStyle: 'rgba(215, 0, 96, 0.9)'
            },
            Void: {
                id: 'Void',
                fillStyle: 'rgba(255, 255, 255, 0)'
            },
            Unclear: {
                id: 'Unclear',
                fillStyle: 'rgba(128, 128, 128, 0.5)'
            }
        }
    }

    function SidewalkColorScheme2 (category) {
        var colors = {
            Walk : {
                id : 'Walk',
                fillStyle : 'rgba(0, 0, 0, 1)'
            },
            CurbRamp: {
                id: 'CurbRamp',
                fillStyle: 'rgba(0, 222, 38, 1)'  // 'rgba(0, 244, 38, 1)'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                fillStyle: 'rgba(233, 39, 113, 1)'  // 'rgba(255, 39, 113, 1)'
            },
            Obstacle: {
                id: 'Obstacle',
                fillStyle: 'rgba(0, 161, 203, 1)'
            },
            Other: {
                id: 'Other',
                fillStyle: 'rgba(179, 179, 179, 1)' //'rgba(204, 204, 204, 1)'
            },
            Occlusion: {
                id: 'Occlusion',
                fillStyle: 'rgba(179, 179, 179, 1)'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                fillStyle: 'rgba(179, 179, 179, 1)'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                fillStyle: 'rgba(241, 141, 5, 1)'
            },
            Void: {
                id: 'Void',
                fillStyle: 'rgba(255, 255, 255, 1)'
            },
            Unclear: {
                id: 'Unclear',
                fillStyle: 'rgba(128, 128, 128, 0.5)'
            }
        };
        return category ? colors[category].fillStyle : colors;
    }

    function SidewalkColorScheme3 (category) {
        var colors = {
            Walk : {
                id : 'Walk',
                fillStyle : 'rgba(0, 0, 0, 1)'
            },
            CurbRamp: {
                id: 'CurbRamp',
                fillStyle: 'rgba(79, 180, 105, 1)'  // 'rgba(0, 244, 38, 1)'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                fillStyle: 'rgba(210, 48, 30, 1)'  // 'rgba(255, 39, 113, 1)'
            },
            Obstacle: {
                id: 'Obstacle',
                fillStyle: 'rgba(29, 150 , 240, 1)'
            },
            Other: {
                id: 'Other',
                fillStyle: 'rgba(180, 150, 200, 1)' //'rgba(204, 204, 204, 1)'
            },
            Occlusion: {
                id: 'Occlusion',
                fillStyle: 'rgba(179, 179, 179, 1)'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                fillStyle: 'rgba(179, 179, 179, 1)'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                fillStyle: 'rgba(240, 200, 30, 1)'
            },
            Void: {
                id: 'Void',
                fillStyle: 'rgba(255, 255, 255, 1)'
            },
            Unclear: {
                id: 'Unclear',
                fillStyle: 'rgba(128, 128, 128, 0.5)'
            }
        };
        return category ? colors[category].fillStyle : colors;
    }
    /**
     * http://www.colourlovers.com/business/trends/branding/7880/Papeterie_Haute-Ville_Logo
     * @returns {{Walk: {id: string, fillStyle: string}, CurbRamp: {id: string, fillStyle: string}, NoCurbRamp: {id: string, fillStyle: string}, StopSign: {id: string, fillStyle: string}, StopSign_OneLeg: {id: string, fillStyle: string}, StopSign_TwoLegs: {id: string, fillStyle: string}, StopSign_Column: {id: string, fillStyle: string}, Landmark_Shelter: {id: string, fillStyle: string}, Landmark_Bench: {id: string, fillStyle: string}, Landmark_TrashCan: {id: string, fillStyle: string}, Landmark_MailboxAndNewsPaperBox: {id: string, fillStyle: string}, Landmark_OtherPole: {id: string, fillStyle: string}}}
     */
    function colorScheme2 () {
        return {
            'Walk' : {
                'id' : 'Walk',
                'fillStyle' : 'rgba(0, 0, 0, 0.9)'
            },
            CurbRamp: {
                id: 'CurbRamp',
                fillStyle: 'rgba(106, 230, 36, 0.9)'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                fillStyle: 'rgba(215, 0, 96, 0.9)'
            },
            'StopSign' : {
                'id' : 'StopSign',
                'fillStyle' : 'rgba(0, 161, 203, 0.9)'
            },
            'StopSign_OneLeg' : {
                'id' : 'StopSign_OneLeg',
                'fillStyle' : 'rgba(0, 161, 203, 0.9)'
            },
            'StopSign_TwoLegs' : {
                'id' : 'StopSign_TwoLegs',
                'fillStyle' : 'rgba(0, 161, 203, 0.9)'
            },
            'StopSign_Column' : {
                'id' : 'StopSign_Column',
                'fillStyle' : 'rgba(0, 161, 203, 0.9)'
            },
            'Landmark_Shelter' : {
                'id' : 'Landmark_Shelter',
                'fillStyle' : 'rgba(215, 0, 96, 0.9)'
            },
            'Landmark_Bench' : {
                'id' : 'Landmark_Bench',
                // 'fillStyle' : 'rgba(229, 64, 40, 0.9)' // Kind of hard to distinguish from pink
                // 'fillStyle' : 'rgba(209, 209, 2, 0.9)' // Puke-y
                'fillStyle' : 'rgba(252, 217, 32, 0.9)'
            },
            'Landmark_TrashCan' : {
                'id' : 'Landmark_TrashCan',
                'fillStyle' : 'rgba(97, 174, 36, 0.9)'
            },
            'Landmark_MailboxAndNewsPaperBox' : {
                'id' : 'Landmark_MailboxAndNewsPaperBox',
                'fillStyle' : 'rgba(67, 113, 190, 0.9)'
            },
            'Landmark_OtherPole' : {
                'id' : 'Landmark_OtherPole',
                'fillStyle' : 'rgba(249, 79, 101, 0.9)'
            }
        }
    }

    return {
        className: 'ColorScheme',
        SidewalkColorScheme: SidewalkColorScheme,
        SidewalkColorScheme2: SidewalkColorScheme2
    };
}());

svl.misc = UtilitiesMisc(JSON);

function Onboarding ($) {
    var self = { className : 'Onboarding' },
        ctx, canvasWidth = 720, canvasHeight = 480,
        properties = {},
        status = {
            state: 0,
            isOnboarding: true
        },
        states = {
            "initialize": {
                "properties": {
                    "action": "Introduction",
                    "heading": 280,
                    "pitch": -6,
                    "zoom": 1,
                    "lat": 38.94042608,
                    "lng": -77.06766133
                },
                "message": {
                    "message": function () {
                            var dom = document.getElementById("onboarding-initial-instruction");
                            return dom ? dom.innerHTML : "";
                        },
                    "position": "center",
                    "width": 1000,
                    "top": -50,
                    "padding": "100px 10px 100px 10px",
                    "left": -70,
                    "background": true
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "initialize"});
                    return this.getAttribute("value") == "OK" ? "select-label-type-1" : null;
                }
            },
            "select-label-type-1": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'In this Street View image, we have drawn an arrow to a curb ramp. Let’s label it. Click the flashing <span class="bold">"Curb Ramp"</span> button above.',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 10280,
                        "y": -385,
                        "length": 50,
                        "angle": 0,
                        "text": null
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-1"});
                    return "label-attribute-1";
                }
            },
            "label-attribute-1": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
                    "labelType": "CurbRamp",
                    "imageX": 10280,
                    "imageY": -425,
                    "tolerance": 300
                },
                "message": {
                    "message": 'Good! Now, <span class="bold">click the curb ramp</span> beneath the yellow arrow to label it.',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 10280,
                        "y": -385,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-1"});
                    return "rate-attribute-1";
                }
            },
            "rate-attribute-1": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'On this context menu, you can rate the quality of the curb ramp, ' +
                    'where 1 is passable and 5 is not passable for a wheelchair user.</span> ' +
                    '<span class="bold">Let’s rate it as 1, passable.</span><br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "rate-attribute-1"});
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "adjust-heading-angle-1" : "redo-rate-attribute-1"
                }
            },
            "redo-rate-attribute-1": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'Uh-oh, you should rate this curb ramp as 1, passable. ' +
                    '<span class="bold">Let\s click "1" to set its quality.</span><br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-1"});
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "adjust-heading-angle-1" : "redo-rate-attribute-1"
                }
            },
            "adjust-heading-angle-1": {
                "properties": {
                    "action": "AdjustHeadingAngle",
                    "heading": 230,
                    "tolerance": 20
                },
                "message": {
                    "message": 'Great! Let’s adjust the view to look at another corner of the intersection on the left. ' +
                    '<span class="bold">Grab and drag the Street View image.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-1"});
                    return "select-label-type-2";
                }
            },
            "select-label-type-2": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'Now we’ve found another curb ramp. Let’s label it! <span class="bold">Click the “Curb Ramp” button</span> like before.',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 8550,
                        "y": -400,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": null
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-2"});
                    return "label-attribute-2";
                }
            },
            "label-attribute-2": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
                    "labelType": "CurbRamp",
                    "imageX": 8720,
                    "imageY": -549,
                    "tolerance": 300
                },
                "message": {
                    "message": 'Now, <span class="bold">click on the curb ramp to label it.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 8550,
                        "y": -400,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-2"});
                    return "rate-severity-2";
                }
            },
            "rate-severity-2": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'Good, now <span class="bold">rate the quality</span> of the curb ramp.<br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-2"});
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "select-label-type-3" : "redo-rate-attribute-2"
                }
            },
            "redo-rate-attribute-2": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'Uh-oh, you should rate this curb ramp as 1, passable. ' +
                    '<span class="bold">Let\s click "1" to set its quality.</span><br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-2"});
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "select-label-type-3" : "redo-rate-attribute-2"
                }
            },
            "select-label-type-3": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "NoCurbRamp"
                },
                "message": {
                    "message": 'Notice that there is no curb ramp at the end of this crosswalk. <span class="bold">Click the "Missing Cub Ramp" button</span> to label it.',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 8300,
                        "y": -500,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": null
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-3"});
                    return "label-attribute-3";
                }
            },
            "label-attribute-3": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
                    "labelType": "NoCurbRamp",
                    "imageX": 8237,
                    "imageY": -600,
                    "tolerance": 300
                },
                "message": {
                    "message": 'Now click beneath the yellow arrow to <span class="bold">label the missing curb ramp.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 8300,
                        "y": -500,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-3"});
                    return "rate-severity-3";
                }
            },
            "rate-severity-3": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "NoCurbRamp",
                    "severity": 3
                },
                "message": {
                    "message": 'Since this missing curb ramp is next to an existing curb ramp, this accessibility problem is less severe. So, let’s <span class="bold">rate it as a 3.</span> Just use your best judgment! <br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no curb ramp quality as 3, a slightly severe problem">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-3"});
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 3 ? "adjust-heading-angle-2" : "redo-rate-attribute-3"
                }
            },
            "redo-rate-attribute-3": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "NoCurbRamp",
                    "severity": 3
                },
                "message": {
                    "message": 'Hmm, this is a slightly severe problem. ' +
                    '<span class="bold">Let\s click "3" to change the severity of the missing curb ramp.</span><br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingNoCurbRampSeverity.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating the no curb ramp quality as 3, a slightly severe problem">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-3"});
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 3 ? "adjust-heading-angle-2" : "redo-rate-attribute-3"
                }
            },
            "adjust-heading-angle-2": {
                "properties": {
                    "action": "AdjustHeadingAngle",
                    "heading": 75,
                    "tolerance": 20
                },
                "message": {
                    "message": 'Great! We need to investigate all of the corners on this intersection, so let’s adjust our view.  <span class="bold">Grab and drag the Street View image.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-2"});
                    return "select-label-type-4";
                }
            },
            "select-label-type-4": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'OK, this corner has two curb ramps. Let’s label them both! <span class="bold">Click the "Curb Ramp" button.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 2170,
                        "y": -650,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "white"
                    },
                    {
                        "type": "arrow",
                        "x": 3218,
                        "y": -900,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "white"
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-4"});
                    return "label-attribute-4";
                }
            },
            "label-attribute-4": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
                    "labelType": "CurbRamp",
                    "imageX": 2170,
                    "imageY": -900,
                    "tolerance": 300
                },
                "message": {
                    "message": 'Now, <span class="bold">click the curb ramp</span> to label it.',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 2170,
                        "y": -650,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-4"});
                    return "rate-severity-4";
                }
            },
            "rate-severity-4": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": null
                },
                "message": {
                    "message": 'Now <span class="bold">rate the curb ramp’s quality</span>. Use your best judgment. You can also write in notes in the <span class="bold">Description Box.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-4"});
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "select-label-type-5" : "redo-rate-attribute-4";
                }
            },
            "redo-rate-attribute-4": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'Hmm, you should rate this curb ramp as 1, passable. ' +
                    '<span class="bold">Let\s click "1" to change its rating.</span><br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-4"});
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "select-label-type-5" : "redo-rate-attribute-4";
                }
            },
            "select-label-type-5": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": '<span class="bold">Click the "Curb Ramp" button</span> to label the other curb ramp now.',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 3218,
                        "y": -900,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "white"
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-5"});
                    return "label-attribute-5";
                }
            },
            "label-attribute-5": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
                    "labelType": "CurbRamp",
                    "imageX": 3218,
                    "imageY": -1203,
                    "tolerance": 300
                },
                "message": {
                    "message": 'Now, <span class="bold">click on the curb ramp to label it.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 3218,
                        "y": -900,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-5"});
                    return "rate-severity-5";
                }
            },
            "rate-severity-5": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": null
                },
                "message": {
                    "message": '<span class="bold">Let’s rate the quality of the curb ramp.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-5"});
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "select-label-type-6" : "redo-rate-attribute-5";
                }
            },
            "redo-rate-attribute-5": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'Hmm, you should rate this curb ramp as 1, passable. ' +
                    '<span class="bold">Let\s click "1" to change its rating.</span><br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-5"});
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "select-label-type-6" : "redo-rate-attribute-5";
                }
            },
            "select-label-type-6": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "Other",
                    "subcategory": "NoSidewalk"
                },
                "message": {
                    "message": 'Notice that the sidewalk suddenly ends here. Let’s label this. <span class="bold">Click the "Other" button then "No Sidewalk" to label it.</span>',
                    "position": "top-left",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 1966,
                        "y": -500,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "white"
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-6"});
                    return "label-attribute-6";
                }
            },
            "label-attribute-6": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
                    "labelType": "Other",
                    "subcategory": "NoSidewalk",
                    "imageX": 1996,
                    "imageY": -526,
                    "tolerance": 300
                },
                "message": {
                    "message": '<span class="bold">Click on the ground</span> where the sidewalk is missing.',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 1966,
                        "y": -500,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-6"});
                    return "adjust-heading-angle-3";
                }
            },
            "adjust-heading-angle-3": {
                "properties": {
                    "action": "AdjustHeadingAngle",
                    "heading": 17,
                    "tolerance": 20
                },
                "message": {
                    "message": 'Awesome! We’re almost done with the training. Let’s learn how to walk. First, <span class="bold">grab and drag the Street View image.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', { onboardingTransition: "adjust-heading-angle-3" });
                    return "walk-1";
                }
            },
            "walk-1": {
                "properties": {
                    "action": "WalkTowards",
                    "panoId": "9xq0EwrjxGwQqNmzNaQTNA"
                },
                "message": {
                    "message": 'Notice the arrow is pointing to another curb ramp, but the image is a bit washed out. Let’s take a step to see if we can get a better look.',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "OgLbmLAuC4urfE5o7GP_JQ",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 700,
                        "y": -400,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "white"
                    },
                    {
                        "type": "double-click",
                        "x": -341,
                        "y": -703,
                        "width": 100
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "walk-1"});
                    svl.map.setPov({heading: 34, pitch: -13, zoom: 1}, 1000);
                    return "select-label-type-7";
                }
            },
            "select-label-type-7": {
                "properties": {
                    "action": "SelectLabelType",
                    "labelType": "CurbRamp"
                },
                "message": {
                    "message": 'Good! There is a curb ramp. <span class="bold">Click the "Curb Ramp" button on the menu to label it!</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 1500,
                        "y": -650,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "white"
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "select-label-type-7"});
                    return "label-attribute-7";
                }
            },
            "label-attribute-7": {
                "properties": {
                    "action": "LabelAccessibilityAttribute",
                    "labelType": "CurbRamp",
                    "imageX": 1492,
                    "imageY": -783,
                    "tolerance": 300
                },
                "message": {
                    "message": '<span class="bold">Click on the curb ramp to label it.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": [
                    {
                        "type": "arrow",
                        "x": 1500,
                        "y": -650,
                        "length": 50,
                        "angle": 0,
                        "text": null,
                        "fill": "yellow"
                    }
                ],
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "label-attribute-7"});
                    return "rate-severity-7";
                }
            },
            "rate-severity-7": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": null
                },
                "message": {
                    "message": '<span class="bold">Let’s rate the quality of the curb ramp.</span><br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "rate-severity-7"});
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "adjust-heading-angle-4" : "redo-rate-attribute-7";
                }
            },
            "redo-rate-attribute-7": {
                "properties": {
                    "action": "RateSeverity",
                    "labelType": "CurbRamp",
                    "severity": 1
                },
                "message": {
                    "message": 'Hmm, you should rate this curb ramp as 1, passable. ' +
                    '<span class="bold">Let\s click "1" to change its rating.</span><br> ' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/RatingCurbRampQuality.gif" + '" class="width-75" style="margin: 5px auto;display:block;" alt="Rating curb ramp quality as 1, passable">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "redo-rate-attribute-7"});
                    var severity = parseInt(this.getAttribute("value"), 10); // I expect the caller to set this to the <input type="radio">.
                    return severity == 1 ? "adjust-heading-angle-4" : "redo-rate-attribute-7";
                }
            },
            "adjust-heading-angle-4": {
                "properties": {
                    "action": "AdjustHeadingAngle",
                    "heading": 267,
                    "tolerance": 20
                },
                "message": {
                    "message": 'Great! Let’s adjust the view to look at another corner on the left. <span class="bold">Grab and drag the Street View image.</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "adjust-heading-angle-4"});
                    return "instruction-1";
                }
            },
            "instruction-1": {
                "properties": {
                    "action": "Instruction",
                    "blinks": null
                },
                "message": {
                    "message": 'Great! You have already labeled the curb ramp at this corner from the previous angle, ' +
                    'so <span class="bold">you do not need to label it again!</span>',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-1"});
                    svl.compass.showMessage();
                    return "instruction-2";
                }
            },
            "instruction-2": {
                "properties": {
                    "action": "Instruction",
                    "blinks": ["google-maps", "compass"]
                },
                "message": {
                    "message": 'From here on, we\'ll guide you which way to walk and with the navigation message ' +
                    '(<img src="' + svl.rootDirectory + "img/onboarding/Compass.png" + '" width="80px" alt="Navigation message: walk straight">) ' +
                    'and the red line on the map.<br>' +
                    '<img src="' + svl.rootDirectory + "img/onboarding/GoogleMaps.png" + '" class="width-75" style="margin: 5px auto;display:block;" alt="An instruction saying follow the red line on the Google Maps">',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-2"});
                    return "instruction-3";
                }
            },
            "instruction-3": {
                "properties": {
                    "action": "Instruction",
                    "blinks": ["status-field"]
                },
                "message": {
                    "message": 'Your progress will be tracked and shown on the right side of the interface.',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-3"});
                    return "instruction-4";
                }
            },
            "instruction-4": {
                "properties": {
                    "action": "Instruction",
                    "blinks": ["zoom", "action-stack"]
                },
                "message": {
                    "message": 'Other interface features include: <br>' +
                    '<span class="bold">Zoom In/Out:</span> Zoom in or out the Street View image<br> ' +
                    '<span class="bold">Undo/Redo:</span> Undo or redo the labeling',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-4"});
                    return "instruction-5";
                }
            },
            "instruction-5": {
                "properties": {
                    "action": "Instruction",
                    "blinks": ["sound", "jump", "feedback"]
                },
                "message": {
                    "message": 'Other interface features include: <br>' +
                    '<span class="bold">Sound:</span> Turn on/off the sound effects <br> ' +
                    '<span class="bold">Jump:</span> Click if you want to audit a different street <br>' +
                    '<span class="bold">Feedback:</span> Provide comments',
                    "position": "top-right",
                    "parameters": null
                },
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "instruction-5"});
                    return "outro";
                }
            },
            "outro": {
                "properties": {
                    "action": "Instruction",
                    "heading": 280,
                    "pitch": -6,
                    "zoom": 1
                },
                "message": {
                    "message": function () {
                        return document.getElementById("onboarding-outro").innerHTML;
                    },
                    "position": "center",
                    "width": 1000,
                    "top": -10,
                    "padding": "100px 10px 100px 10px",
                    "left": -70,
                    "background": true
                },
                "okButton": false,
                "panoId": "9xq0EwrjxGwQqNmzNaQTNA",
                "annotations": null,
                "transition": function () {
                    svl.tracker.push('Onboarding_Transition', {onboardingTransition: "outro"});
                    return null;
                }
            }
        };

    function _init () {
        status.isOnboarding = true;

        if ("ui" in svl) {
            var canvas = svl.ui.onboarding.canvas.get(0);
            if (canvas) ctx = canvas.getContext('2d');
            svl.ui.onboarding.holder.css("visibility", "visible");
        }

        if ("map" in svl) {
            svl.map.unlockDisableWalking().disableWalking().lockDisableWalking();
        }

        if ("compass" in svl) {
            svl.compass.hideMessage();
        }

        status.state = getState("initialize");
        visit(status.state);
        initializeHandAnimation();
    }

    /**
     * Clear the onboarding canvas
     * @returns {clear}
     */
    function clear () {
        if (ctx) ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        return this;
    }

    /**
     * Draw a double click icon on the onboarding canvas
     * @param x {number} X coordinate
     * @param y {number} Y coordiante
     * @returns {drawDoubleClickIcon}
     */
    function drawDoubleClickIcon (x, y) {
        // https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage
        var image = document.getElementById("double-click-icon");
        ctx.save();
        ctx.drawImage(image, x - 50, y - 50, 100, 100);
        ctx.restore();
        return this;
    }

    /**
     * Draw an arrow on the onboarding canvas
     * @param x1 {number} Starting x coordinate
     * @param y1 {number} Starting y coordinate
     * @param x2 {number} Ending x coordinate
     * @param y2 {number} Ending y coordinate
     * @param parameters {object} parameters
     * @returns {drawArrow}
     */
    function drawArrow (x1, y1, x2, y2, parameters) {
        if (ctx) {
            var lineWidth = 1,
                fill = 'rgba(255,255,255,1)',
                lineCap = 'round',
                arrowWidth = 6,
                strokeStyle  = 'rgba(96, 96, 96, 1)',
                dx, dy, theta;

            if ("fill" in parameters && parameters.fill) fill = parameters.fill;

            dx = x2 - x1;
            dy = y2 - y1;
            theta = Math.atan2(dy, dx);

            ctx.save();
            ctx.fillStyle = fill;
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = lineCap;

            ctx.translate(x1, y1);
            ctx.beginPath();
            ctx.moveTo(arrowWidth * Math.sin(theta), - arrowWidth * Math.cos(theta));
            ctx.lineTo(dx + arrowWidth * Math.sin(theta), dy - arrowWidth * Math.cos(theta));

            // Draw an arrow head
            ctx.lineTo(dx + 3 * arrowWidth * Math.sin(theta), dy - 3 * arrowWidth * Math.cos(theta));
            ctx.lineTo(dx + 3 * arrowWidth * Math.cos(theta), dy + 3 * arrowWidth * Math.sin(theta));
            ctx.lineTo(dx - 3 * arrowWidth * Math.sin(theta), dy + 3 * arrowWidth * Math.cos(theta));

            ctx.lineTo(dx - arrowWidth * Math.sin(theta), dy + arrowWidth * Math.cos(theta));
            ctx.lineTo(- arrowWidth * Math.sin(theta), + arrowWidth * Math.cos(theta));

            ctx.fill();
            ctx.stroke();
            ctx.closePath();
            ctx.restore();
        }
        return this;
    }

    /**
     * Get a state
     * @param stateIndex
     * @returns {*}
     */
    function getState(stateIndex) {
        return states[stateIndex];
    }

    /**
     * Hide the message box.
     */
    function hideMessage () {
        if (svl.ui.onboarding.messageHolder.is(":visible")) svl.ui.onboarding.messageHolder.hide();
    }

    /**
     * Transition to the next state
     * @param nextState
     */
    function next (nextState) {
        if (typeof nextState == "function") {
            status.state = getState(nextState.call(this));
            visit(status.state);
        } else if (nextState in states) {
            status.state = getState(nextState);
            visit(status.state);
        } else {
            visit(null);
        }
    }

    /**
     * Show a message box
     * @param parameters
     */
    function showMessage (parameters) {
        var message = parameters.message, position = parameters.position;
        if (!position) position = "top-right";

        svl.ui.onboarding.messageHolder.toggleClass("yellow-background");
        setTimeout(function () { svl.ui.onboarding.messageHolder.toggleClass("yellow-background"); }, 100);

        svl.ui.onboarding.messageHolder.css({
            top: 0,
            left: 0,
            width: 300
        });

        // The following code is broken due to Chrome's bug. It does not properly re-render the text box.
        // if (position == "top-left") {
        //     svl.ui.onboarding.messageHolder.css({
        //         top: 0,
        //         left: 0
        //     });
        // } else {
        //     svl.ui.onboarding.messageHolder.css({
        //         top: 0,
        //         left: 410
        //     });
        // }
        if (!svl.ui.onboarding.messageHolder.is(":visible")) svl.ui.onboarding.messageHolder.show();


        svl.ui.onboarding.background.css("visibility", "hidden");
        if (parameters) {
            if ("width" in parameters) {
                svl.ui.onboarding.messageHolder.css("width", parameters.width);
            }

            if ("left" in parameters) {
                svl.ui.onboarding.messageHolder.css("left", parameters.left);
            }

            if ("top" in parameters) {
                svl.ui.onboarding.messageHolder.css("top", parameters.top);
            }

            if ("background" in parameters && parameters.background) {
                svl.ui.onboarding.background.css("visibility", "visible");
            }
        }

        svl.ui.onboarding.messageHolder.html((typeof message == "function" ? message() : message));
    }

    /**
     * Execute an instruction based on the current state.
     * @param state
     */
    function visit(state) {
        var i, len, message, callback, annotationListener;
        clear(); // Clear what ever was rendered on the onboarding-canvas in the previous state.
        hideMessage();
        if (!state) {
            // End of onboarding. Transition to the actual task.
            var task = svl.taskContainer.getCurrentTask();
            var data = svl.form.compileSubmissionData(task);
            svl.form.submit(data, task);
            svl.ui.onboarding.background.css("visibility", "hidden");
            svl.map.unlockDisableWalking().enableWalking().lockDisableWalking();
            setStatus("isOnboarding", false);
            svl.storage.set("completedOnboarding", true);

            if ("user" in svl && svl.user && svl.user.getProperty("username") !== "anonymous" && "missionContainer" in svl && "missionFactory" in svl) {
                var onboardingMission = svl.missionContainer.getMission(null, "onboarding");
                onboardingMission.setProperty("isCompleted", true);
                svl.missionContainer.stage(onboardingMission).commit();
            }

            // Set the next mission
            var mission = svl.missionContainer.getMission("noRegionId", "initial-mission");
            if (mission.isCompleted()) {
                var neighborhood = svl.neighborhoodContainer.getStatus("currentNeighborhood");
                var missions = svl.missionContainer.getMissionsByRegionId(neighborhood.getProperty("regionId"));
                missions.map(function (m) { if (!m.isCompleted()) return m;});
                mission = missions[0];  // Todo. Take care of the case where length of the missions is 0
            }
            svl.missionContainer.setCurrentMission(mission);
            svl.modalMission.setMission(mission);
            
            svl.taskContainer.initNextTask();

            return;
        }

        // Show user a message box.
        if ("message" in state && state.message) {
            showMessage(state.message);
        }

        // Draw arrows to annotate target accessibility attributes
        if ("annotations" in state && state.annotations) {
            var coordinate, imX, imY, lineLength, lineAngle, x1, x2, y1, y2, currentPOV = svl.map.getPov(), drawAnnotations;
            len = state.annotations.length;

            drawAnnotations = function () {
                clear();
                for (i = 0; i < len; i++) {
                    imX = state.annotations[i].x;
                    imY = state.annotations[i].y;
                    currentPOV = svl.map.getPov();

                    // Map an image coordinate to a canvas coordinate
                    if (currentPOV.heading < 180) {
                        if (imX > svl.svImageWidth - 3328 && imX > 3328) {
                            imX -= svl.svImageWidth;
                        }
                    } else {
                        if (imX < 3328 && imX < svl.svImageWidth - 3328) {
                            imX += svl.svImageWidth;
                        }
                    }
                    coordinate = svl.misc.imageCoordinateToCanvasCoordinate(imX, imY, currentPOV);

                    if (state.annotations[i].type == "arrow") {
                        lineLength = state.annotations[i].length;
                        lineAngle = state.annotations[i].angle;
                        x2 = coordinate.x;
                        y2 = coordinate.y;
                        x1 = x2 - lineLength * Math.sin(svl.util.math.toRadians(lineAngle));
                        y1 = y2 - lineLength * Math.cos(svl.util.math.toRadians(lineAngle));
                        drawArrow(x1, y1, x2, y2, { "fill": state.annotations[i].fill });
                    } else if (state.annotations[i].type == "double-click") {
                        drawDoubleClickIcon(coordinate.x, coordinate.y);
                    }

                }
            };
            drawAnnotations();
            if (typeof google != "undefined")  annotationListener = google.maps.event.addListener(svl.panorama, "pov_changed", drawAnnotations);
        }

        // A nested function responsible for detaching events from google maps
        function removeAnnotationListener () {
            if (annotationListener) google.maps.event.removeListener(annotationListener);
        }

        // Change behavior based on the current state.
        if ("properties" in state) {
            var $target, labelType, subcategory;
            if (state.properties.action == "Introduction") {
                var pov = { heading: state.properties.heading, pitch: state.properties.pitch, zoom: state.properties.zoom },
                    googleTarget, googleCallback;

                // I need to nest callbacks due to the bug in Street View; I have to first set panorama, and set POV
                // once the panorama is loaded. Here I let the panorama load while the user is reading the instruction.
                // When they click OK, then the POV changes.
                googleCallback = function () {
                    svl.panorama.setPano(state.panoId);
                    // svl.map.setPov(pov);
                    // svl.map.setPosition(state.properties.lat, state.properties.lng);
                    google.maps.event.removeListener(googleTarget);
                };
                googleTarget = google.maps.event.addListener(svl.panorama, "position_changed", googleCallback);

                $target = $("#onboarding-message-holder").find("button");
                callback = function () {
                    $target.off("click", callback);
                    removeAnnotationListener();
                    next.call(this, state.transition);
                    svl.panorama.setPano(state.panoId);
                    svl.map.setPov(pov);
                    svl.map.setPosition(state.properties.lat, state.properties.lng);

                    if ("compass" in svl) svl.compass.hideMessage();
                };
                $target.on("click", callback);
            } else if (state.properties.action == "SelectLabelType") {
                // Blink the given label type and nudge them to click one of the buttons in the ribbon menu.
                // Move on to the next state if they click the button.
                labelType = state.properties.labelType;
                subcategory = "subcategory" in state.properties ? state.properties.subcategory : null;
                if ("ribbon" in svl) {
                    svl.ribbon.startBlinking(labelType, subcategory);
                }

                if (subcategory) {
                    $target = $(svl.ui.ribbonMenu.subcategoryHolder.find('[val="' + subcategory + '"]').get(0));
                } else {
                    $target = $(svl.ui.ribbonMenu.holder.find('[val="' + labelType + '"]').get(0));
                }

                callback = function () {
                    svl.ribbon.stopBlinking();
                    $target.off("click", callback); // Remove the handler
                    removeAnnotationListener();
                    next(state.transition);
                };
                $target.on("click", callback);
            } else if (state.properties.action == "LabelAccessibilityAttribute") {
                // Tell the user to label the target attribute.
                var imageX = state.properties.imageX,
                    imageY = state.properties.imageY,
                    tolerance = state.properties.tolerance;
                labelType = state.properties.labelType;
                $target = svl.ui.canvas.drawingLayer;

                callback = function (e) {
                    // Check if the point that the user clicked is close enough to the given ground truth point.
                    var clickCoordinate = mouseposition(e, this),
                        pov = svl.map.getPov(),
                        canvasX = clickCoordinate.x,
                        canvasY = clickCoordinate.y,
                        imageCoordinate = svl.misc.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov),
                        distance = (imageX - imageCoordinate.x) * (imageX - imageCoordinate.x) + (imageY - imageCoordinate.y) * (imageY - imageCoordinate.y);

                    if (distance < tolerance * tolerance) {
                        $target.off("click", callback);
                        removeAnnotationListener();
                        next(state.transition);
                    }
                };
                $target.on("click", callback);
            } else if (state.properties.action == "RateSeverity" || state.properties.action == "RedoRateSeverity") {
                var severity = state.properties.severity;
                $target = svl.ui.contextMenu.radioButtons;
                labelType = state.properties.labelType;
                callback = function () {
                    $target.off("click", callback);
                    removeAnnotationListener();
                    next.call(this, state.transition);
                };
                $target.on("click", callback);  // This can be changed to "$target.one()"
            } else if (state.properties.action == "AdjustHeadingAngle") {
                // Tell them to remove a label.
                showGrabAndDragAnimation({direction: "left-to-right"});
                callback = function () {
                    var pov = svl.map.getPov();
                    if ((360 + state.properties.heading - pov.heading) % 360 < state.properties.tolerance) {
                        if (typeof google != "undefined") google.maps.event.removeListener($target);
                        removeAnnotationListener();
                        hideGrabAndDragAnimation();
                        next(state.transition);
                    }
                };
                // Add and remove a listener: http://stackoverflow.com/questions/1544151/google-maps-api-v3-how-to-remove-an-event-listener
                if (typeof google != "undefined") $target = google.maps.event.addListener(svl.panorama, "pov_changed", callback);
            } else if (state.properties.action == "WalkTowards") {
                svl.map.unlockDisableWalking().enableWalking().lockDisableWalking();
                callback = function () {
                    var panoId = svl.map.getPanoId();
                    if (state.properties.panoId == panoId) {
                        window.setTimeout(function () { svl.map.unlockDisableWalking().disableWalking().lockDisableWalking(); }, 1000);
                        if (typeof google != "undefined") google.maps.event.removeListener($target);
                        removeAnnotationListener();
                        next(state.transition);
                    } else {
                        svl.panorama.setPano(state.panoId); // Force the interface to go back to the previous position.
                    }
                };
                // Add and remove a listener: http://stackoverflow.com/questions/1544151/google-maps-api-v3-how-to-remove-an-event-listener
                // $target = google.maps.event.addListener(svl.panorama, "pano_changed", callback);
                if (typeof google != "undefined") $target = google.maps.event.addListener(svl.panorama, "position_changed", callback);

                // Sometimes Google changes the topology of Street Views and so double clicking/clicking arrows do not
                // take the user to the right panorama. In that case, programmatically move the user.
                var currentClick, previousClick, canvasX, canvasY, pov, imageCoordinate;
                var mouseUpCallback = function (e) {
                    currentClick = new Date().getTime();


                    // Check if the user has double clicked
                    if (previousClick && currentClick - previousClick < 300) {
                        canvasX = mouseposition(e, this).x;
                        canvasY = mouseposition(e, this).y;
                        pov = svl.map.getPov();
                        imageCoordinate = svl.misc.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov);

                        // Check if where the user has clicked is in the right spot on the canvas
                        var doubleClickAnnotationCoordinate = state.annotations.filter(function (x) { return x.type == "double-click"; })[0];
                        if (Math.sqrt(Math.pow(imageCoordinate.y - doubleClickAnnotationCoordinate.y, 2) +
                                    Math.pow(imageCoordinate.x - doubleClickAnnotationCoordinate.x, 2)) < 300) {
                            svl.ui.map.viewControlLayer.off("mouseup", mouseUpCallback);
                            svl.panorama.setPano(state.properties.panoId);
                            callback();
                        }
                    }
                    previousClick = currentClick;
                };
                svl.ui.map.viewControlLayer.on("mouseup", mouseUpCallback);
            } else if (state.properties.action == "Instruction") {
                if (!("okButton" in state) || state.okButton) {
                    // Insert an ok button.
                    svl.ui.onboarding.messageHolder.append("<br/><button id='onboarding-ok-button' class='button width-50'>OK</button>");
                }

                // Blink parts of the interface
                if ("blinks" in state.properties && state.properties.blinks) {
                    len = state.properties.blinks.length;
                    for (i = 0; i < len; i++) {
                        switch (state.properties.blinks[i]) {
                            case "google-maps":
                                svl.map.blinkGoogleMaps();
                                break;
                            case "compass":
                                svl.compass.blink();
                                break;
                            case "status-field":
                                svl.statusField.blink();
                                break;
                            case "zoom":
                                svl.zoomControl.blink();
                                break;
                            case "action-stack":
                                svl.actionStack.blink();
                                break;
                            case "sound":
                                svl.audioEffect.blink();
                                break;
                            case "jump":
                                svl.modalSkip.blink();
                                break;
                            case "feedback":
                                svl.modalComment.blink();
                                break;
                        }
                    }
                }

                $target = $("#onboarding-ok-button");
                callback = function () {
                    $target.off("click", callback);
                    removeAnnotationListener();

                    if ("blinks" in state.properties && state.properties.blinks) {
                        svl.map.stopBlinkingGoogleMaps();
                        svl.compass.stopBlinking();
                        svl.statusField.stopBlinking();
                        svl.zoomControl.stopBlinking();
                        svl.actionStack.stopBlinking();
                        svl.audioEffect.stopBlinking();
                        svl.modalSkip.stopBlinking();
                        svl.modalComment.stopBlinking();
                    }

                    next.call(this, state.transition);
                };
                $target.on("click", callback);
            }
        }
    }


    // Code for hand animation.
    // Todo. Clean up.
    var layer, stage, OpenHand, ClosedHand, OpenHandReady = false, ClosedHandReady = false,
        ImageObjOpenHand = new Image(), ImageObjClosedHand = new Image(), handAnimationInterval;

    function initializeHandAnimation () {
        if (document.getElementById("hand-gesture-holder")) {
            hideGrabAndDragAnimation();
            stage = new Kinetic.Stage({
                container: "hand-gesture-holder",
                width: 720,
                height: 200
            });
            layer = new Kinetic.Layer();
            stage.add(layer);
            ImageObjOpenHand.onload = function () {
                OpenHand = new Kinetic.Image({
                    x: 0,
                    y: stage.getHeight() / 2 - 59,
                    image: ImageObjOpenHand,
                    width: 128,
                    height: 128
                });
                OpenHand.hide();
                layer.add(OpenHand);
                OpenHandReady = true;
            };
            ImageObjOpenHand.src = svl.rootDirectory + "img/onboarding/HandOpen.png";

            ImageObjClosedHand.onload = function () {
                ClosedHand = new Kinetic.Image({
                    x: 300,
                    y: stage.getHeight() / 2 - 59,
                    image: ImageObjClosedHand,
                    width: 96,
                    height: 96
                });
                ClosedHand.hide();
                layer.add(ClosedHand);
                ClosedHandReady = true;
            };
            ImageObjClosedHand.src = svl.rootDirectory + "img/onboarding/HandClosed.png";
        }
    }

    /**
     * References:
     * Kineticjs callback: http://www.html5canvastutorials.com/kineticjs/html5-canvas-transition-callback-with-kineticjs/
     * Setposition: http://www.html5canvastutorials.com/labs/html5-canvas-animals-on-the-beach-game-with-kineticjs/
     */
    function animateHand(direction) {
        if (direction === 'left-to-right') {
            ClosedHand.hide();
            OpenHand.setPosition(350,100);
            OpenHand.show();
            OpenHand.transitionTo({
                x: 350,
                y: 30,
                duration : 0.5,
                callback : function () {
                    setTimeout(function () {
                        OpenHand.hide();
                        ClosedHand.setPosition(400, 60);
                        ClosedHand.show();
                        ClosedHand.transitionTo({
                            x: 550,
                            y: 60,
                            duration: 1
                        });
                    }, 300);
                }
            });
        } else {
            ClosedHand.hide();
            OpenHand.setPosition(200,100);
            OpenHand.show();
            OpenHand.transitionTo({
                x: 200,
                y: 0,
                duration : 0.5,
                callback : function () {
                    setTimeout(function () {
                        OpenHand.hide();
                        ClosedHand.setPosition(200, 30);
                        ClosedHand.show();
                        ClosedHand.transitionTo({
                            x: 0,
                            y: 30,
                            duration: 1
                        });
                    }, 300);
                }
            });
        }
    }

    function showGrabAndDragAnimation (parameters) {
        if (ClosedHandReady && OpenHandReady) {
            svl.ui.onboarding.handGestureHolder.css("visibility", "visible");
            animateHand("left-to-right");
            handAnimationInterval = setInterval(animateHand.bind(null, "left-to-right"), 2000);
        }
    }

    function hideGrabAndDragAnimation () {
        clearInterval(handAnimationInterval);
        svl.ui.onboarding.handGestureHolder.css("visibility", "hidden");
    }

    /**
     * Check if the user is working on the onboarding right now
     * @returns {boolean}
     */
    function isOnboarding () {
        return status.isOnboarding;
    }

    /**
     * Set status
     * @param key Status field name
     * @param value Status field value
     * @returns {setStatus}
     */
    function setStatus (key, value) {
        if (key in status) status[key] = value;
        return this;
    }

    self.clear = clear;
    self.drawArrow = drawArrow;
    self.next = next;
    self.isOnboarding = isOnboarding;
    self.showMessage = showMessage;
    self.setStatus = setStatus;
    self.hideMessage = hideMessage;

    _init();

    return self;
}