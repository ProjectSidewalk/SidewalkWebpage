/**
 * Fog.js
 *
 * @Author: Ruofei Du
 * @InitialCreator: Sean Panella and Vicki Le & Kotaro (Aug 12th, 2013.)
 * @Date: Sep 17, 2013
 * @Comment: we don't need Fog/Clipper.js now
 *
 **/

 /** @namespace */
 var svl = svl || {};
 
/** Google Maps Fog API
 *
 * @ Requirements:
 *   Google Maps JavaScript V3 API (https://developers.google.com/maps/documentation/javascript/)
 *   Javascript Clipper (http://sourceforge.net/projects/jsclipper/)
 * @ Public Functions:
 *   updateFromPOV: Updates the fog based on the new POV
 *   clearMap: Clears all of the fog

 * Creates a new GMFog Object
 *
 * @ Required Parameters
 * map: google.maps.Map object for the map that the fog will overlay (should already be loaded)
 * center: google.maps.LatLng object for the center of the circle
 * radius: Radius of the fog (decimal)
 * @ Optional Parameters
 * strokeColor: String of hex color representing the outline of the fog ("#080A17" for example)
 * strokeOpacity: Opacity of the outline of the fog (decimal)
 * strokeWeight: Weight of the outline of the fog (decimal)
 * fillColor: Color of the fog (same format as strokeColor)
 * fillOpacity: Opacity of the fog (decimal)
 **/
// function Fog(map, center, radius, max, strokeColor, strokeOpacity, strokeWeight, fillColor, fillOpacity) {
function Fog(mapIn, params) {
    var self = {className: 'Fog'};
    var properties = {};
    var pointerVisitedLeft = 0;
    var pointerVisitedRight = 0;
    var dirCurrentLeft = 0;
    var dirCurrentRight = 0;
    var dirCurrentMid = 0;
    var dirVisitedMid = 0;
    var dirVisitedMidLeftHandside = 0;
    var dirVisitedMidRightHandside = 0;
    var polygonVisitedLeft = null;
    var polygonVisitedRight = null;
    var polygonFog = null;
    var pathVisitedLeft = null;
    var pathVisitedRight = null;
    var pathFog = null;
    var deltaHeading = 0;
    var rotateThreshold = 1.0;
    var m_firstRun = true;
    var m_isCompleted = false;
    var m_completionRate = 0;
    var m_completionRate2 = 0;

    var map = mapIn;

    ////////////////////////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////////////////////////
    function _init(params) {
        // This method initializes the object properties.
        if (!("center" in params) || !params.center) {
            throw "Center cannot be null when constructing a GMFog!";
        } else {
            properties.center = params.center;
        }
        if (!("radius" in params) || !params.radius) {
            throw "Radius cannot be null when constructing a GMFog!";
        } else {
            properties.radius = params.radius;
        }
        if (!("max" in params) || params.max) {
            properties.max = 700;
        } else {
            properties.max = 360;
        }
        if (!("strokeColor" in params) || params.strokeColor) {
            properties.strokeColor = "#080A17";
        } else {
            properties.strokeColor = params.strokeColor;
        }
        if (!("fillColor" in params) || params.fillColor) {
            properties.fillColor = "#080A17";
        } else {
            properties.fillColor = params.fillColor;
        }
        if (!("strokeOpacity" in params) || params.strokeOpacity) {
            properties.strokeOpacity = 0.7;
        } else {
            properties.strokeOpacity = params.strokeOpacity;
        }
        if (!("fillOpacity" in params) || params.fillOpacity) {
            properties.fillOpacity = 0.7;
        } else {
            properties.fillOpacity = params.fillOpacity;
        }
        if (!("strokeWeight" in params) || params.strokeWeight) {
            properties.strokeWeight = 0.7;
        } else {
            properties.strokeWeight = params.strokeWeight;
        }

        //
        // Initialize the zoom view angle
        if ("zoomViewAngles" in params && params.zoomViewAngles) {
            properties.zoomviewAngle = params.zoomViewAngles;
        } else {
            properties.zoomviewAngle    = [];
            properties.zoomviewAngle[1] = Math.PI / 6; // Math.PI / 4;
            properties.zoomviewAngle[2] = Math.PI / 10; // Math.PI / 6;
            properties.zoomviewAngle[3] = Math.PI / 14; //Math.PI / 8;
        }

        properties.visitedColor = "#66c2a5";
        properties.visitedOpacity = 0.3;
        properties.infiniteDistance = 1;        // 1 in latitude is enough.
    }

    //
    // Unify the angel between 0 and 2PI
    function unifyAngel(radius) {
        var ans = radius;
        while (ans < 0) ans += Math.PI * 2;
        while (ans > Math.PI * 2) ans -= Math.PI * 2;
        return ans;
    }

    //
    // Calculate the angular bisector between 2 rays with directions.
    function midAngel(left, right, clockwise) {
        clockwise = typeof clockwise !== 'undefined' ? clockwise : true;

        var ans = (left + right) / 2;
        if (left < Math.PI) {
            if (right < Math.PI) {
                if (right < left) {
                    ans += Math.PI;
                }
            }
        } else {
            if (right < Math.PI) {
                ans += Math.PI;
            } else {
                if (left > right) {
                    ans += Math.PI;
                }
            }
        }

        return unifyAngel(ans);
    }

    ////////////////////////////////////////////////////////////
    // Public:
    ////////////////////////////////////////////////////////////
    self.completionRate = function (strategy) {
        strategy = typeof strategy !== 'undefined' ? strategy : 0;
        return strategy == 0 ? m_completionRate : m_completionRate2;
    };

    self.updateFromPOV = function(current, povRadius, dir, arc) {
        /**
         * Main iterative method updates the fog according to the new direction & zoom level.
         *
         * current: new position in google latlng
         * povRadius: line of sight
         * dir: direction in radians
         * arc: arc size in radians
         *
         * TODO: when zooming in, updateFromPOV is not called.
         **/
        var lat = current.lat();
        var lng = current.lng();

        // 1. remember the delta, make the left pointer to 2PI and the right 0
        if (m_firstRun) {
            deltaHeading = dir;
        }

        var pov = getPOV();
        var deltaViewAngel = properties.zoomviewAngle[pov.zoom];

        var heading = unifyAngel(dir - deltaHeading);
        dirCurrentLeft = unifyAngel(heading - deltaViewAngel);
        dirCurrentRight = unifyAngel(heading + deltaViewAngel);

        // 2. calculate current pointer and update visited pointer
        if (m_firstRun) {
            pointerVisitedLeft = dirCurrentLeft;
            pointerVisitedRight = dirCurrentRight;
        } else {
            if (dirCurrentLeft < pointerVisitedLeft && Math.abs(dirCurrentLeft - pointerVisitedLeft) < rotateThreshold) pointerVisitedLeft = dirCurrentLeft;
            if (dirCurrentRight > pointerVisitedRight && Math.abs(dirCurrentRight - pointerVisitedRight) < rotateThreshold) pointerVisitedRight = dirCurrentRight;
            if (pointerVisitedLeft < pointerVisitedRight && !m_isCompleted) m_isCompleted = true;
        }

        // 3. update the completion rate
        m_completionRate = (pointerVisitedRight + Math.PI * 2 - pointerVisitedLeft) / (Math.PI * 2);
        m_completionRate2 = (pointerVisitedRight + Math.PI * 2 - pointerVisitedLeft - properties.zoomviewAngle[1]) / (Math.PI * 2);

        if (m_completionRate > 1.0) m_completionRate = 1.0;
        if (m_completionRate2 > 1.0) m_completionRate2 = 1.0;

        dirCurrentLeft = unifyAngel(dirCurrentLeft + deltaHeading);
        dirCurrentRight = unifyAngel(dirCurrentRight + deltaHeading);

        // 4. calculate the angular bisector
        if (!m_isCompleted)
        {
            dirCurrentMid = midAngel(dirCurrentLeft, dirCurrentRight, true);
            var dirVisitedLeft = unifyAngel(pointerVisitedLeft + deltaHeading);
            var dirVisitedRight = unifyAngel(pointerVisitedRight + deltaHeading);
            dirVisitedMidLeftHandside = midAngel(dirVisitedLeft, dirCurrentLeft, true);
            dirVisitedMidRightHandside = midAngel(dirCurrentRight, dirVisitedRight, true);
            dirVisitedMid = midAngel(dirVisitedRight, dirVisitedLeft, true);

            // 5. calculate the polygons
            pathFog = [
                new google.maps.LatLng(lat, lng),
                new google.maps.LatLng(lat + Math.cos(dirVisitedRight), lng + Math.sin(dirVisitedRight)),
                new google.maps.LatLng(lat + Math.cos(dirVisitedMid), lng + Math.sin(dirVisitedMid)),
                new google.maps.LatLng(lat + Math.cos(dirVisitedLeft), lng + Math.sin(dirVisitedLeft))
            ];

            pathVisitedLeft = [
                new google.maps.LatLng(lat, lng),
                new google.maps.LatLng(lat + Math.cos(dirVisitedLeft), lng + Math.sin(dirVisitedLeft)),
                new google.maps.LatLng(lat + Math.cos(dirVisitedMidLeftHandside), lng + Math.sin(dirVisitedMidLeftHandside)),
                new google.maps.LatLng(lat + Math.cos(dirCurrentLeft), lng + Math.sin(dirCurrentLeft))
            ];

            pathVisitedRight = [
                new google.maps.LatLng(lat, lng),
                new google.maps.LatLng(lat + Math.cos(dirCurrentRight), lng + Math.sin(dirCurrentRight)),
                new google.maps.LatLng(lat + Math.cos(dirVisitedMidRightHandside), lng + Math.sin(dirVisitedMidRightHandside)),
                new google.maps.LatLng(lat + Math.cos(dirVisitedRight), lng + Math.sin(dirVisitedRight))
            ];
        } else {
            dirCurrentMid = unifyAngel(midAngel(dirCurrentLeft, dirCurrentRight, false) + Math.PI);
            pathVisitedLeft = [
                new google.maps.LatLng(lat, lng),
                new google.maps.LatLng(lat + Math.cos(dirCurrentRight), lng + Math.sin(dirCurrentRight)),
                new google.maps.LatLng(lat + Math.cos(dirCurrentMid), lng + Math.sin(dirCurrentMid)),
                new google.maps.LatLng(lat + Math.cos(dirCurrentLeft), lng + Math.sin(dirCurrentLeft))
            ];

            // TODO: Hide the following 2 polygons by API.
            pathFog = [
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance),
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance),
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance),
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance)
            ];

            pathVisitedRight = [
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance),
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance),
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance),
                new google.maps.LatLng(lat + properties.infiniteDistance, lng + properties.infiniteDistance)
            ];
        }

        if (m_firstRun) {
            polygonVisitedLeft = new google.maps.Polygon({
                paths: pathVisitedLeft,
                strokeColor: properties.strokeColor,
                strokeOpacity: properties.strokeOpacity,
                strokeWeight: properties.strokeWeight,
                fillColor: properties.visitedColor,
                fillOpacity: properties.visitedOpacity,
                map: map
            });

            polygonVisitedRight = new google.maps.Polygon({
                paths: pathVisitedRight,
                strokeColor: properties.strokeColor,
                strokeOpacity: properties.strokeOpacity,
                strokeWeight: properties.strokeWeight,
                fillColor: properties.visitedColor,
                fillOpacity: properties.visitedOpacity,
                map: map
            });

            polygonFog = new google.maps.Polygon({
                paths: pathFog,
                strokeColor: properties.strokeColor,
                strokeOpacity: properties.strokeOpacity,
                strokeWeight: properties.strokeWeight,
                fillColor: properties.fillColor,
                fillOpacity: properties.fillOpacity,
                map: map
            });

            m_firstRun = false;
        } else {
            polygonVisitedLeft.setPath(pathVisitedLeft);
            polygonVisitedRight.setPath(pathVisitedRight);
            polygonFog.setPath(pathFog);
        }
        return;
    };

    self.setProperty = function (key, val) {
        // This method sets the property
        properties[key] = val;
        return;
    };

    _init(params);
    return self;
}

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
    }
    
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

        url = "http://maps.google.com/cbk?output=json&cb_client=maps_sv&v=4&dm=1&pm=1&ph=1&hl=en&panoid=" + panoId;

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

var svl = svl || {};

/**
 * ActionStack keeps track of user's actions.
 * @param {object} $ jQuery ojbect
 * @param {object} params Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ActionStack ($, params) {
    var self = {
        'className' : 'ActionStack'
        };
    var properties = {};
    var status = {
            actionStackCursor : 0, // This is an index of current state in actionStack
            disableRedo : false,
            disableUndo : false
        };
    var lock = {
            disableRedo : false,
            disableUndo : false
        };
    var actionStack = [];

    // jQuery dom objects
    var $buttonRedo;
    var $buttonUndo;


    ////////////////////////////////////////
    // Private Functions
    ////////////////////////////////////////
    function init (params) {
        // Initialization function
        if (svl.ui && svl.ui.actionStack) {
          // $buttonRedo = $(params.domIds.redoButton);
          // $buttonUndo = $(params.domIds.undoButton);
          $buttonRedo = svl.ui.actionStack.redo;
          $buttonUndo = svl.ui.actionStack.undo;
          $buttonRedo.css('opacity', 0.5);
          $buttonUndo.css('opacity', 0.5);

          // Attach listeners to buttons
          $buttonRedo.bind('click', buttonRedoClick);
          $buttonUndo.bind('click', buttonUndoClick);
        }
    }


    function buttonRedoClick () {
        if (!status.disableRedo) {
          if ('tracker' in svl) {
            svl.tracker.push('Click_Redo');
          }
            self.redo();
        }
    }


    function buttonUndoClick () {
        if (!status.disableUndo) {
          if ('tracker' in svl) {
            svl.tracker.push('Click_Undo');
          }
            self.undo();
        }
    }

    ////////////////////////////////////////
    // Public methods
    ////////////////////////////////////////
    self.disableRedo = function () {
        if (!lock.disableRedo) {
            status.disableRedo = true;
            if (svl.ui && svl.ui.actionStack) {
              $buttonRedo.css('opacity', 0.5);
            }
            return this;
        } else {
            return false;
        }
    };


    self.disableUndo = function () {
        if (!lock.disableUndo) {
            status.disableUndo = true;
            if (svl.ui && svl.ui.actionStack) {
              $buttonUndo.css('opacity', 0.5);
            }
            return this;
        } else {
            return false;
        }
    };


    self.enableRedo = function () {
        if (!lock.disableRedo) {
            status.disableRedo = false;
            if (svl.ui && svl.ui.actionStack) {
              $buttonRedo.css('opacity', 1);
            }
            return this;
        } else {
            return false;
        }
    };


    self.enableUndo = function () {
        if (!lock.disableUndo) {
            status.disableUndo = false;
            if (svl.ui && svl.ui.actionStack) {
              $buttonUndo.css('opacity', 1);
            }
            return this;
        } else {
            return false;
        }
    };

    self.getStatus = function(key) {
        if (!(key in status)) {
            console.warn("You have passed an invalid key for status.")
        }
        return status[key];
    };

    self.lockDisableRedo = function () {
        lock.disableRedo = true;
        return this;
    };


    self.lockDisableUndo = function () {
        lock.disableUndo = true;
        return this;
    };


    self.pop = function () {
        // Delete the last action
        if (actionStack.length > 0) {
            status.actionStackCursor -= 1;
            actionStack.splice(status.actionStackCursor);
        }
        return this;
    };


    self.push = function (action, label) {
        var availableActionList = ['addLabel', 'deleteLabel'];
        if (availableActionList.indexOf(action) === -1) {
            throw self.className + ": Illegal action.";
        }

        var actionItem = {
            'action' : action,
            'label' : label,
            'index' : status.actionStackCursor
        };
        if (actionStack.length !== 0 &&
            actionStack.length > status.actionStackCursor) {
            // Delete all the action items after the cursor before pushing the new acitonItem
            actionStack.splice(status.actionStackCursor);
        }
        actionStack.push(actionItem);
        status.actionStackCursor += 1;
        return this;
    };


    self.redo = function () {
        // Redo an action
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
    };

    self.size = function () {
        // return the size of the stack

        return actionStack.length;
    };

    self.undo = function () {
        // Undo an action
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
    };


    self.unlockDisableRedo = function () {
        lock.disableRedo = false;
        return this;
    };


    self.unlockDisableUndo = function () {
        lock.disableUndo = false;
        return this;
    };

    self.getLock = function(key) {
        if (!(key in lock)) {
          console.warn("You have passed an invalid key for status.")
        }
        return lock[key];
    };

    self.updateOpacity = function () {
        // Change opacity
        if (svl.ui && svl.ui.actionStack) {
          if (status.actionStackCursor < actionStack.length) {
              $buttonRedo.css('opacity', 1);
          } else {
              $buttonRedo.css('opacity', 0.5);
          }

          if (status.actionStackCursor > 0) {
              $buttonUndo.css('opacity', 1);
          } else {
              $buttonUndo.css('opacity', 0.5);
          }

          // if the status is set to disabled, then set the opacity of buttons to 0.5 anyway.
          if (status.disableUndo) {
              $buttonUndo.css('opacity', 0.5);
          }
          if (status.disableRedo) {
              $buttonRedo.css('opacity', 0.5);
          }
        }
    };

    init(params);

    return self;
}

////////////////////////////////////////////////////////////////////////////////
// Global variables
////////////////////////////////////////////////////////////////////////////////
// var canvasWidth = 720;
// var canvasHeight = 480;
// var svImageHeight = 6656;
// var svImageWidth = 13312;

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

    // jQuery doms
    var $divLabelDrawingLayer = $("div#labelDrawingLayer").length === 0 ? null : $("div#labelDrawingLayer");
    var $divHolderLabelDeleteIcon = $("#Holder_LabelDeleteIcon").length === 0 ? null : $("#Holder_LabelDeleteIcon");
    var $labelDeleteIcon = $("#LabelDeleteIcon").length === 0 ? null : $("#LabelDeleteIcon");

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
        if ($divLabelDrawingLayer) {
          $divLabelDrawingLayer.bind('mousedown', drawingLayerMouseDown);
          $divLabelDrawingLayer.bind('mouseup', drawingLayerMouseUp);
          $divLabelDrawingLayer.bind('mousemove', drawingLayerMouseMove);
        }
        if ($labelDeleteIcon) {
          $labelDeleteIcon.bind("click", labelDeleteIconClick);
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
            labelColor = getLabelColors()[labelType],
            labelDescription = getLabelDescriptions()[svl.ribbon.getStatus('selectedLabelType')],
            iconImagePath = getLabelIconImagePath()[labelDescription.id].iconImagePath;

        pointParameters.fillStyleInnerCircle = labelColor.fillStyle;
        pointParameters.iconImagePath = iconImagePath;
        pointParameters.radiusInnerCircle = properties.pointInnerCircleRadius;
        pointParameters.radiusOuterCircle = properties.pointOuterCircleRadius;

        var pathLen = tempPath.length,
            points = [],
            pov = svl.getPOV();

        for (var i = 0; i < pathLen; i++) {
            points.push(new Point(tempPath[i].x, tempPath[i].y, pov, pointParameters));
        }
        var path = new Path(points, {});
        var latlng = getPosition();
        var param = {
            canvasWidth: svl.canvasWidth,
            canvasHeight: svl.canvasHeight,
            canvasDistortionAlphaX: svl.alpha_x,
            canvasDistortionAlphaY: svl.alpha_y,
            //labelId: svl.getLabelCounter(),
            labelType: labelDescription.id,
            labelDescription: labelDescription.text,
            labelFillStyle: labelColor.fillStyle,
            panoId: getPanoId(),
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
        labels.push(status.currentLabel);
        svl.labelContainer.push(status.currentLabel);

        svl.tracker.push('LabelingCanvas_FinishLabeling', { 'temporary_label_id': status.currentLabel.getProperty('temporary_label_id')});
        svl.actionStack.push('addLabel', status.currentLabel);

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

    /**
     * This function is fired when at the time of mouse-down
     * @param e
     */
    function drawingLayerMouseDown (e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = mouseposition(e, this).x;
        mouseStatus.leftDownY = mouseposition(e, this).y;

        if (!properties.evaluationMode) {
            svl.tracker.push('LabelingCanvas_MouseDown', {x: mouseStatus.leftDownX, y: mouseStatus.leftDownY});
        }

        mouseStatus.prevMouseDownTime = new Date().getTime();
    }

    /**
     * This function is fired when at the time of mouse-up
     */
    function drawingLayerMouseUp (e) {
        var currTime;

        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = mouseposition(e, this).x;
        mouseStatus.leftUpY = mouseposition(e, this).y;

        currTime = new Date().getTime();

        if (!properties.evaluationMode) {
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

                self.clear();
                self.setVisibilityBasedOnLocation('visible', getPanoId());
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
                        self.setVisibilityBasedOnLocation('visible', getPanoId());
                        self.render2();
                    }
                }
            }
        } else {
            // If it is an evaluation mode, do... (nothing)
        }

        svl.tracker.push('LabelingCanvas_MouseUp', {x: mouseStatus.leftUpX, y: mouseStatus.leftUpY});
        mouseStatus.prevMouseUpTime = new Date().getTime();
        mouseStatus.prevMouseDownTime = 0;
    }

    /**
     * This function is fired when mouse cursor moves over the drawing layer.
     */
    function drawingLayerMouseMove (e) {
        var mousePosition = mouseposition(e, this);
        mouseStatus.currX = mousePosition.x;
        mouseStatus.currY = mousePosition.y;

        // Change a cursor according to the label type.
        // $(this).css('cursor', )
        if ('ribbon' in svl) {
            var cursorImagePaths = svl.misc.getLabelCursorImagePath();
            var labelType = svl.ribbon.getStatus('mode');
            if (labelType) {
                var cursorImagePath = cursorImagePaths[labelType].cursorImagePath;
                var cursorUrl = "url(" + cursorImagePath + ") 6 25, auto";

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
                self.showLabelTag(status.currentLabel);
                ret.renderBoundingBox(ctx);
            } else {
                self.showLabelTag(undefined);
            }
        }
        self.clear();
        self.render2();
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
                var x = $divHolderLabelDeleteIcon.css('left');
                var y = $divHolderLabelDeleteIcon.css('top');
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
                $divHolderLabelDeleteIcon.css('visibility', 'hidden');

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
            labelColor = getLabelColors()[svl.ribbon.getStatus('selectedLabelType')],
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

        var pointData, pov, point,
            labelColors = svl.misc.getLabelColors(),
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

        var param = {};
        var path;
        var labelDescriptions = svl.misc.getLabelDescriptions();

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
     * @method
     */
    function lockDisableLabelDelete () {
        status.lockDisableLabelDelete = true;
        return this;
    }

    /**
     * @method
     */
    function lockDisableLabelEdit () {
        status.lockDisableLabelEdit = true;
        return this;
    }

    /**
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
        svl.labelContainer.removeAll();
        return this;
    }

    /**
     * This function removes a passed label and its child path and points
     * @method
     */
//    function removeLabel (label) {
//        if (!label) {
//            return false;
//        }
//        svl.tracker.push('RemoveLabel', {labelId: label.getProperty('labelId')});
//
//        label.setStatus('deleted', true);
//        label.setStatus('visibility', 'hidden');
//
//
//        // Review label correctness if this is a ground truth insertion task.
//        if (("goldenInsertion" in svl) &&
//            svl.goldenInsertion &&
//            svl.goldenInsertion.isRevisingLabels()) {
//            svl.goldenInsertion.reviewLabels();
//        }
//
//        self.clear();
//        self.render2();
//        return this;
//    }

    /**
     * Renders labels
     * @method
     */
    function render2 () {
        if (!ctx) { return this; }
        var i, label, lenLabels,
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
        var pov = svl.getPOV();


        var points, pointsLen, pointData, svImageCoordinate, deltaHeading, deltaPitch, x, y;
        // The image coordinates of the points in system labels shift as the projection parameters (i.e., heading and pitch) that
        // you can get from Street View API change. So adjust the image coordinate
        // Note that this adjustment happens only once
        if (!status.svImageCoordinatesAdjusted) {
            var currentPhotographerPov = svl.panorama.getPhotographerPov();
            if (currentPhotographerPov && 'heading' in currentPhotographerPov && 'pitch' in currentPhotographerPov) {
                var j;
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

            if (properties.evaluationMode) {
                label.render(ctx, pov, true);
            } else {
                label.render(ctx, pov);
            }

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

        // Check if the user audited all the angles or not.
        if ('form' in svl) { svl.form.checkSubmittable(); }

        // Update the completion rate
        if ('progressPov' in svl) { svl.progressPov.updateCompletionRate(); }

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
     * @method
     */
    function setStatus (key, value) {
        // This function is allows other objects to access status
        // of this object
        if (key in status) {
            if (key === 'disableLabeling') {
                if (typeof value === 'boolean') {
                    if (value) {
                        self.disableLabeling();
                    } else {
                        self.enableLabeling();
                    }
                    return this;
                } else {
                    return false;
                }
            } else if (key === 'disableMenuClose') {
                if (typeof value === 'boolean') {
                    if (value) {
                        self.disableMenuClose();
                    } else {
                        self.enableMenuClose();
                    }
                    return this;
                } else {
                    return false;
                }
            } else if (key === 'disableLabelDelete') {
                if (value === true) {
                    self.disableLabelDelete();
                } else if (value === false) {
                    self.enableLabelDelete();
                }
            } else {
                status[key] = value;
            }
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
            if (label) {
                for (i = 0; i < labelLen; i += 1) {
                    //if (labels[i] === label) {
                    if (labels[i].getLabelId() === label.getLabelId()) {
                        labels[i].setTagVisibility('visible');
                        isAnyVisible = true;
                    } else {
                        labels[i].setTagVisibility('hidden');
                        labels[i].resetTagCoordinate();
                    }
                }
            } else {
                for (i = 0; i < labelLen; i++) {
                    labels[i].setTagVisibility('hidden');
                    labels[i].resetTagCoordinate();
                }
                $divHolderLabelDeleteIcon.css('visibility', 'hidden');
            }
            // If any of the tags is visible, show a deleting icon on it.
            if (!isAnyVisible) {
                $divHolderLabelDeleteIcon.css('visibility', 'hidden');
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
     * @method
     */
    function setVisibilityBasedOnLocation (visibility) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;

        for (var i = 0; i < labelLen; i += 1) {
            labels[i].setVisibilityBasedOnLocation(visibility, getPanoId());
        }
        return this;
    }

    /**
     * This function should not be used in labeling interfaces, but only in evaluation interfaces.
     * Set labels that are not in LabelerIds hidden
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
    self.removeLabel = svl.labelContainer.removeLabel;
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

function Compass ($) {
    "use strict";
    var self = { className : 'Compass' },
        status = {},
        properties = {};

    var height = 50, width = 50, padding = 5,
        needleRadius = 10,
        el = d3.select('#compass-holder'),
        svg = el.append('svg'),
        chart = svg.append('g');

    svg.attr('width', width + 2 * padding)
        .attr('height', height + 2 * padding)
        .style({ position: 'absolute', left: 660, top: 520 });
    chart.attr('transform', 'translate(' + (height / 2) + ', ' + (width / 2) + ')');
    chart.append('circle')
        .attr('cx', 0) .attr('cy', 0).attr('r', width / 2)
        .attr('fill', 'black');
    chart.append('circle')
        .attr('cx', 0) .attr('cy', 10).attr('r', needleRadius)
        .attr('fill', 'white');
    chart.append('path')
        .attr('d', 'M 0 -' + (width / 2 - 3) + ' L 10 9 L -10 9')
        .attr('fill', 'white');


    /**
     * Get the angle to the next goal.
     * @returns {number}
     */
    function getTargetAngle () {
        var latlng = svl.getPosition(),
            geometry = svl.task.getGeometry(),
            coordinates = geometry.coordinates,
            distArray = coordinates.map(function(o) { return norm(latlng.lat, latlng.lng, o[1], o[0]) }),
            minimum = Math.max.apply(Math, distArray),
            argmin = distArray.indexOf(minimum),
            argTarget = (argmin < (coordinates.length - 1)) ? argmin + 1 : geometry.coordinates.length - 1;

        return svl.util.math.toDegrees(Math.atan2(coordinates[argTarget][0] - latlng.lng, coordinates[argTarget][1] - latlng.lat));
    }

    /**
     * Get the compass angle
     * @returns {number}
     */
    function getCompassAngle () {
        var heading = svl.getPOV().heading,
            targetAngle = getTargetAngle();
        return heading - targetAngle;
    }

    /** Return the sum of square of lat and lng diffs */
    function norm (lat1, lng1, lat2, lng2) { return Math.pow(lat2 - lat1, 2) + Math.pow(lng2 - lng1, 2); }

    /**
     * Update the compass visualization
     */
    function update () {
        var compassAngle = getCompassAngle();
        chart.transition(500).attr('transform', 'translate(' + (height / 2) + ', ' + (width / 2) + ') rotate(' + (-compassAngle) + ')');
    }

    self.update = update;
    return self;
}

var svl = svl || {};

/**
 * @memberof svl
 * @constructor
 */
function ExampleWindow ($, params) {
    var self = { className : 'ExampleWindow'},
        properties = {
            exampleCategories : ['StopSign_OneLeg', 'StopSign_TwoLegs', 'StopSign_Column', 'NextToCurb', 'AwayFromCurb']
        },
        status = {
            open : false
        };

        // jQuery elements
    var $divHolderExampleWindow;
    var $divHolderCloseButton;
    var $divExampleOneLegStopSign;
    var $divExampleTwoLegStopSign;
    var $divExampleColumnStopSign;
    var $divExampleNextToCurb;
    var $divExampleAwayFromCurb;
    var exampleWindows = {};

    ////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////
    function init (params) {
        // Initialize jQuery elements
        $divHolderExampleWindow = $(params.domIds.holder);
        $divHolderCloseButton = $(params.domIds.closeButtonHolder);
        $divExampleOneLegStopSign = $(params.domIds.StopSign_OneLeg);
        $divExampleTwoLegStopSign = $(params.domIds.StopSign_TwoLegs);
        $divExampleColumnStopSign = $(params.domIds.StopSign_Column);
        $divExampleNextToCurb = $(params.domIds.NextToCurb);
        $divExampleAwayFromCurb = $(params.domIds.AwayFromCurb);

        exampleWindows = {
            StopSign_OneLeg : $divExampleOneLegStopSign,
            StopSign_TwoLegs : $divExampleTwoLegStopSign,
            StopSign_Column : $divExampleColumnStopSign,
            NextToCurb : $divExampleNextToCurb,
            AwayFromCurb : $divExampleAwayFromCurb
        };

        // Add listeners
        $divHolderCloseButton.bind({
            click : self.close,
            mouseenter : closeButtonMouseEnter,
            mouseleave : closeButtonMouseLeave
        });
    }


    function closeButtonMouseEnter () {
        // A callback function that is invoked when a mouse cursor enters the X sign.
        // This function changes a cursor to a pointer.
        $(this).css({
            cursor : 'pointer'
        });
        return this;
    }

    function closeButtonMouseLeave () {
        // A callback function that is invoked when a mouse cursor leaves the X sign.
        // This function changes a cursor to a 'default'.
        $(this).css({
            cursor : 'default'
        });
        return this;
    }


    self.close = function () {
        // Hide the example window.
        status.open = false;
        $divHolderExampleWindow.css({
            visibility : 'hidden'
        });
        $.each(exampleWindows, function (i, v) {
            v.css({visibility:'hidden'});
        });
        return this;
    };


    self.isOpen = function () {
        return status.open;
    };


    self.show = function (exampleCategory) {
        // Show the example window.
        // Return false if the passed category is not know.
        if (properties.exampleCategories.indexOf(exampleCategory) === -1) {
            return false;
        }

        status.open = true;
        $divHolderExampleWindow.css({
            visibility : 'visible'
        });

        $.each(exampleWindows, function (i, v) {
            console.log(i);
            if (i === exampleCategory) {
                v.css({visibility:'visible'});
            } else {
                v.css({visibility:'hidden'});
            }
        });

        return this;
    };

    ////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////
    init(params);
    return self;
}

var svl = svl || {};

/**
 * A form module
 * @param $ {object} jQuery object
 * @param params {object} Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Form ($, params) {
    var self = {
        'className' : 'Form'
    };

    var properties = {
        commentFieldMessage: undefined,
        isAMTTask : false,
        isPreviewMode : false,
        previousLabelingTaskId: undefined,
        dataStoreUrl : undefined,
        onboarding : false,
        taskRemaining : 0,
        taskDescription : undefined,
        taskPanoramaId: undefined,
        hitId : undefined,
        assignmentId: undefined,
        turkerId: undefined,
        userExperiment: false
    };
    var status = {
        disabledButtonMessageVisibility: 'hidden',
        disableSkipButton : false,
        disableSubmit : false,
        radioValue: undefined,
        skipReasonDescription: undefined,
        submitType: undefined,
        taskDifficulty: undefined,
        taskDifficultyComment: undefined
    };
    var lock = {
        disableSkipButton : false,
        disableSubmit : false
    };

    // jQuery doms
    var $form;
    var $textieldComment;
    var $btnSubmit;
    var $btnSkip;
    var $btnConfirmSkip;
    var $btnCancelSkip;
    var $radioSkipReason;
    var $textSkipOtherReason;
    var $divSkipOptions;
    var $pageOverlay;
    var $taskDifficultyWrapper;
    var $taskDifficultyOKButton;

    var messageCanvas;

    ////////////////////////////////////////////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////////////////////////////////////////////
    function _init (params) {
        var hasGroupId = getURLParameter('groupId') !== "";
        var hasHitId = getURLParameter('hitId') !== "";
        var hasWorkerId = getURLParameter('workerId') !== "";
        var assignmentId = getURLParameter('assignmentId');

        properties.onboarding = params.onboarding;
        properties.dataStoreUrl = params.dataStoreUrl;

        if (('assignmentId' in params) && params.assignmentId) {
            properties.assignmentId = params.assignmentId;
        }
        if (('hitId' in params) && params.hitId) {
            properties.hitId = params.hitId;
        }
        if (('turkerId' in params) && params.turkerId) {
            properties.turkerId = params.turkerId;
        }

        if (('userExperiment' in params) && params.userExperiment) {
            properties.userExperiment = true;
        }

        //
        // initiailze jQuery elements.
        $form = $("#BusStopLabelerForm");
        $textieldComment = svl.ui.form.commentField; //$("#CommentField");
        $btnSubmit = svl.ui.form.submitButton;
        $btnSkip = svl.ui.form.skipButton;
        $btnConfirmSkip = $("#BusStopAbsence_Submit");
        $btnCancelSkip = $("#BusStopAbsence_Cancel");
        $radioSkipReason = $('.Radio_BusStopAbsence');
        $textSkipOtherReason = $("#Text_BusStopAbsenceOtherReason");
        $divSkipOptions = $("#Holder_SkipOptions");
        $pageOverlay = $("#page-overlay-holder");


        if (properties.userExperiment) {
            $taskDifficultyOKButton = $("#task-difficulty-button");
            $taskDifficultyWrapper = $("#task-difficulty-wrapper");
        }


        $('input[name="assignmentId"]').attr('value', properties.assignmentId);
        $('input[name="workerId"]').attr('value', properties.turkerId);
        $('input[name="hitId"]').attr('value', properties.hitId);


        if (assignmentId && assignmentId === 'ASSIGNMENT_ID_NOT_AVAILABLE') {
            properties.isPreviewMode = true;
            properties.isAMTTask = true;
            self.unlockDisableSubmit().disableSubmit().lockDisableSubmit();
            self.unlockDisableSkip().disableSkip().lockDisableSkip();
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

        //
        // Check if this is a sandbox task or not
        properties.isSandbox = false;
        if (properties.isAMTTask) {
            if (document.referrer.indexOf("workersandbox.mturk.com") !== -1) {
                properties.isSandbox = true;
                $form.prop("action", "https://workersandbox.mturk.com/mturk/externalSubmit");
            }
        }

        //
        // Check if this is a preview and, if so, disable submission and show a message saying
        // this is a preview.
        if (properties.isAMTTask && properties.isPreviewMode) {
            var dom = '<div class="amt-preview-warning-holder">' +
                '<div class="amt-preview-warning">' +
                'Warning: you are on a Preview Mode!' +
                '</div>' +
                '</div>';
            $("body").append(dom);
            self.disableSubmit();
            self.lockDisableSubmit();
        }

        // if (!('onboarding' in svl && svl.onboarding)) {
        //     messageCanvas = new Onboarding(params, $)
        // }

        //
        // Insert texts in a textfield
        properties.commentFieldMessage = $textieldComment.attr('title');
        $textieldComment.val(properties.commentFieldMessage);

        //
        // Disable Submit button so turkers cannot submit without selecting
        // a reason for not being able to find the bus stop.
        disableConfirmSkip();

        //
        // Attach listeners
        $textieldComment.bind('focus', focusCallback); // focusCallback is in Utilities.js
        $textieldComment.bind('blur', blurCallback); // blurCallback is in Utilities.js
        $form.bind('submit', formSubmit);
        $btnSkip.bind('click', openSkipWindow);
        $btnConfirmSkip.on('click', skipSubmit);
        $btnCancelSkip.on('click', closeSkipWindow);
        $radioSkipReason.on('click', radioSkipReasonClicked);
        // http://stackoverflow.com/questions/11189136/fire-oninput-event-with-jquery
        if ($textSkipOtherReason.get().length > 0) {
            $textSkipOtherReason[0].oninput = skipOtherReasonInput;
        }

        if (properties.userExperiment) {
            $taskDifficultyOKButton.bind('click', taskDifficultyOKButtonClicked);
        }

    }

    /**
     * This method gathers all the data needed for submission.
     * @returns {{}}
     */
    function compileSubmissionData () {
        var data = {};

        data.audit_task = {
            street_edge_id: svl.task.getStreetEdgeId(),
            task_start: svl.task.getTaskStart()
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

        for(var i = 0; i < labels.length; i += 1) {
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
                label_points : []
            };

            for (var j = 0; j < pathLen; j += 1) {
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

//        if (data.labels.length === 0) {
//            data.labelingTask.no_label = 0;
//        }

        // Add the value in the comment field if there are any.
        var comment = $textieldComment.val();
        data.comment = undefined;
        if (comment &&
            comment !== $textieldComment.attr('title')) {
            data.comment = $textieldComment.val();
        }
        return data;
    }

    /**
     * This method disables the confirm skip button
     */
    function disableConfirmSkip () {
        $btnConfirmSkip.attr('disabled', true);
        $btnConfirmSkip.css('color', 'rgba(96,96,96,0.5)');
    }

    /**
     * This method enables the confirm skip button
     */
    function enableConfirmSkip () {
        $btnConfirmSkip.attr('disabled', false);
        $btnConfirmSkip.css('color', 'rgba(96,96,96,1)');
    }

    /**
      * Submit the data.
      * @param data This can be an object of a compiled data for auditing, or an array of
      * the auditing data.
      */
    function submit(data) {
        svl.tracker.push('TaskSubmit');
        svl.labelContainer.refresh();

        if (data.constructor !== Array) {
            data = [data];
        }

        try {
            $.ajax({
                // async: false,
                contentType: 'application/json; charset=utf-8',
                url: properties.dataStoreUrl,
                type: 'post',
                data: JSON.stringify(data),
                dataType: 'json',
                success: function (result) {
                    if (result.error) {
                        console.log(result.error);
                    }
                },
                error: function (result) {
                    throw result;
                    // console.error(result);
                }
            });
        } catch (e) {
            console.error(e);
            return false;
        }
//
//        if (properties.taskRemaining > 1) {
//            window.location.reload();
//            return false;
//        } else {
//            if (properties.isAMTTask) {
//                return true;
//            } else {
//                window.location.reload();
//                //window.location = '/';
//                return false;
//            }
//        }
    }

    /**
     * Callback function that is invoked when a user hits a submit button
     * @param e
     * @returns {boolean}
     */
    function formSubmit (e) {
        if (!properties.isAMTTask || properties.taskRemaining > 1) {
            e.preventDefault();
        }

        var url = properties.dataStoreUrl;
        var data = {};

        if (status.disableSubmit) {
            showDisabledSubmitButtonMessage();
            return false;
        }

        // temp
        // window.location.reload();

        //
        // If this is a task with ground truth labels, check if users made any mistake.
//        if ('goldenInsertion' in svl && svl.goldenInsertion) {
//            var numMistakes = svl.goldenInsertion.reviewLabels();
//            self.disableSubmit().lockDisableSubmit();
//            self.disableSkip().lockDisableSkip();
//            return false;
//        }

        //
        // Disable a submit button and other buttons so turkers cannot submit labels more than once.
        //$btnSubmit.attr('disabled', true);
        //$btnSkip.attr('disabled', true);
        $btnConfirmSkip.attr('disabled', true);
        $pageOverlay.css('visibility', 'visible');


        //
        // If this is a user experiment
        if (properties.userExperiment) {
            if (!status.taskDifficulty) {
                status.submitType = 'submit';
                $taskDifficultyWrapper.css('visibility', 'visible');
                return false;
            }
        }

        //
        // Submit collected data if a user is not in onboarding mode.
        if (!properties.onboarding) {
            data = compileSubmissionData();
            submit(data);
//            svl.tracker.push('TaskSubmit');
//
//            data = compileSubmissionData();
//
//            if (status.taskDifficulty != undefined) {
//                data.taskDifficulty = status.taskDifficulty;
//                data.labelingTask.description = "TaskDifficulty:" + status.taskDifficulty;
//                if (status.taskDifficultyComment) {
//                    data.comment = "TaskDifficultyCommentField:" + status.taskDifficultyComment + ";InterfaceCommentField:" + data.comment
//                }
//            }
//
//            try {
//                $.ajax({
//                    async: false,
//                    contentType: 'application/json; charset=utf-8',
//                    url: url,
//                    type: 'post',
//                    data: JSON.stringify(data),
//                    dataType: 'json',
//                    success: function (result) {
//                        if (result.error) {
//                            console.log(result.error);
//                        }
//                    },
//                    error: function (result) {
//                        throw result;
//                        // console.error(result);
//                    }
//                });
//            } catch (e) {
//                console.error(e);
//                return false;
//            }
//
//            if (properties.taskRemaining > 1) {
//                window.location.reload();
//                return false;
//            } else {
//                if (properties.isAMTTask) {
//                    return true;
//                } else {
//                    window.location.reload();
//                    //window.location = '/';
//                    return false;
//                }
//            }
        }
        return false;
    }

    function goldenInsertionSubmit () {
        // This method submits the labels that a user provided on golden insertion task and refreshes the page.
        if ('goldenInsertion' in svl && svl.goldenInsertion) {
            svl.tracker.push('GoldenInsertion_Submit');
            var url = properties.dataStoreUrl;
            var data;
            svl.goldenInsertion.disableOkButton();

            data = compileSubmissionData();
            data.labelingTask.description = "GoldenInsertion";

            try {
                $.ajax({
                    async: false,
                    url: url,
                    type: 'post',
                    data: data,
                    dataType: 'json',
                    success: function (result) {
                        if (((typeof result) == 'object') && ('error' in result) && result.error) {
                            console.log(result.error);
                        }
                    },
                    error: function (result) {
                        throw result;
                        // console.error(result);
                    }
                });
            } catch (e) {
                console.error(e);
                return false;
            }

            window.location.reload();
        } else {
            throw self.className + ": This method cannot be called without GoldenInsertion";
        }
        return false;
    }

    function showDisabledSubmitButtonMessage () {
        // This method is called from formSubmit method when a user clicks the submit button evne then have
        // not looked around and inspected the entire panorama.
        var completionRate = parseInt(svl.progressPov.getCompletionRate() * 100, 10);

        if (!('onboarding' in svl && svl.onboarding) &&
            (completionRate < 100)) {
            var message = "You have inspected " + completionRate + "% of the scene. Let's inspect all the corners before you submit the task!";
            var $OkBtn;

            //
            // Clear and render the onboarding canvas
            var $divOnboardingMessageBox = undefined; //
            messageCanvas.clear();
            messageCanvas.renderMessage(300, 250, message, 350, 140);
            messageCanvas.renderArrow(650, 282, 710, 282);

            if (status.disabledButtonMessageVisibility === 'hidden') {
                status.disabledButtonMessageVisibility = 'visible';
                var okButton = '<button id="TempOKButton" class="button bold" style="left:20px;position:relative; width:100px;">OK</button>';
                $divOnboardingMessageBox.append(okButton);
                $OkBtn = $("#TempOKButton");
                $OkBtn.bind('click', function () {
                    //
                    // Remove the OK button and clear the message.
                    $OkBtn.remove();
                    messageCanvas.clear();
                    status.disabledButtonMessageVisibility = 'hidden';
                })
            }
        }
    }

    function skipSubmit (e) {
        // To prevent a button in a form to fire form submission, add onclick="return false"
        // http://stackoverflow.com/questions/932653/how-to-prevent-buttons-from-submitting-forms
        if (!properties.isAMTTask || properties.taskRemaining > 1) {
            e.preventDefault();
        }



        var url = properties.dataStoreUrl;
        var data = {};
        //
        // If this is a task with ground truth labels, check if users made any mistake.
        if ('goldenInsertion' in svl && svl.goldenInsertion) {
            self.disableSubmit().lockDisableSubmit();
            $btnSkip.attr('disabled', true);
            $btnConfirmSkip.attr('disabled', true);
            $divSkipOptions.css({
                visibility: 'hidden'
            });
            var numMistakes = svl.goldenInsertion.reviewLabels()
            return false;
        }

        //
        // Disable a submit button.
        $btnSubmit.attr('disabled', true);
        $btnSkip.attr('disabled', true);
        $btnConfirmSkip.attr('disabled', true);
        $pageOverlay.css('visibility', 'visible');


        //
        // If this is a user experiment, run the following lines
        if (properties.userExperiment) {
            if (!status.taskDifficulty) {
                status.submitType = 'skip';
                $taskDifficultyWrapper.css('visibility', 'visible');
                return false;
            }
        }
        //
        // Set a value for skipReasonDescription.
        if (status.radioValue === 'Other:') {
            status.skipReasonDescription = "Other: " + $textSkipOtherReason.val();
        }

        // Submit collected data if a user is not in oboarding mode.
        if (!properties.onboarding) {
            svl.tracker.push('TaskSubmitSkip');

            //
            // Compile the submission data with compileSubmissionData method,
            // then overwrite a part of the compiled data.
            data = compileSubmissionData()
            data.noLabels = true;
            data.labelingTask.no_label = 1;
            data.labelingTask.description = status.skipReasonDescription;

            if (status.taskDifficulty != undefined) {
                data.taskDifficulty = status.taskDifficulty;
                data.labelingTask.description = "TaskDifficulty:" + status.taskDifficulty;
                if (status.taskDifficultyComment) {
                    data.comment = "TaskDifficultyCommentField:" + status.taskDifficultyComment + ";InterfaceCommentField:" + data.comment
                }
            }

            try {
                $.ajax({
                    async: false,
                    url: url,
                    type: 'post',
                    data: data,
                    success: function (result) {
                        if (result.error) {
                            console.log(result.error);
                        }
                    },
                    error: function (result) {
                        throw result;
                        // console.error(self.className, result);
                    }
                });
            } catch (e) {
                console.error(e);
                return false;
            }

            if (properties.taskRemaining > 1) {
                window.location.reload();
                return false;
            } else {
                if (properties.isAMTTask) {
                    // $form.submit();
                    document.getElementById("BusStopLabelerForm").submit();
                    return true;
                } else {
                    // window.location = '/';
                    window.location.reload();
                    return false;
                }
            }

        }
        return false;
    }


    function openSkipWindow (e) {
        e.preventDefault();

        if (status.disableSkip) {
            showDisabledSubmitButtonMessage();
        } else {
            svl.tracker.push('Click_OpenSkipWindow');
            $divSkipOptions.css({
                visibility: 'visible'
            });
        }
        return false;
    }


    function closeSkipWindow (e) {
        // This method closes the skip menu.
        e.preventDefault(); // Do not submit the form!

        svl.tracker.push('Click_CloseSkipWindow');

        $divSkipOptions.css({
            visibility: 'hidden'
        });
        return false;
    }


    function radioSkipReasonClicked () {
        // This function is invoked when one of a radio button is clicked.
        // If the clicked radio button is 'Other', check if a user has entered a text.
        // If the text is entered, then enable submit. Otherwise disable submit.
        status.radioValue = $(this).attr('value');
        svl.tracker.push('Click_SkipRadio', {RadioValue: status.radioValue});

        if (status.radioValue !== 'Other:') {
            status.skipReasonDescription = status.radioValue;
            enableConfirmSkip();
        } else {
            var textValue = $textSkipOtherReason.val();
            if (textValue) {
                enableConfirmSkip();
            } else {
                disableConfirmSkip();
            }
        }
    }

    function skipOtherReasonInput () {
        // This function is invoked when the text is entered in Other field.
        if (status.radioValue && status.radioValue === 'Other:') {
            var textValue = $textSkipOtherReason.val();
            if (textValue) {
                enableConfirmSkip();
            } else {
                disableConfirmSkip();
            }
        }
    }

    function taskDifficultyOKButtonClicked (e) {
        // This is used in the user experiment script
        // Get checked radio value
        // http://stackoverflow.com/questions/4138859/jquery-how-to-get-selected-radio-button-value
        status.taskDifficulty = parseInt($('input[name="taskDifficulty"]:radio:checked').val(), 10);
        status.taskDifficultyComment = $("#task-difficulty-comment").val();
        status.taskDifficultyComment = (status.taskDifficultyComment != "") ? status.taskDifficultyComment : undefined;
        console.log(status.taskDifficultyComment);


        if (status.taskDifficulty) {
            if (('submitType' in status) && status.submitType == 'submit') {
                formSubmit(e);
            } else if (('submitType' in status) && status.submitType == 'skip') {
                skipSubmit(e);
            }
        }
    }
    ////////////////////////////////////////////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////////////////////////////////////////////
    self.checkSubmittable = function () {
        // This method checks whether users can submit labels or skip this task by first checking if they
        // assessed all the angles of the street view.
        // Enable/disable form a submit button and a skip button
        if ('progressPov' in svl && svl.progressPov) {
            var completionRate = svl.progressPov.getCompletionRate();
        } else {
            var completionRate = 0;
        }

        var labelCount = svl.canvas.getNumLabels();

        if (1 - completionRate < 0.01) {
            if (labelCount > 0) {
                self.enableSubmit();
                self.disableSkip();
            } else {
                self.disableSubmit();
                self.enableSkip();
            }
            return true;
        } else {
            self.disableSubmit();
            self.disableSkip();
            return false;
        }
    };

    self.compileSubmissionData = function () {
        // This method returns the return value of a private method compileSubmissionData();
        return compileSubmissionData();
    }

    self.disableSubmit = function () {
        if (!lock.disableSubmit) {
            status.disableSubmit = true;
            //  $btnSubmit.attr('disabled', true);
            $btnSubmit.css('opacity', 0.5);
            return this;
        }
        return false;
    };


    self.disableSkip = function () {
        if (!lock.disableSkip) {
            status.disableSkip = true;
            // $btnSkip.attr('disabled', true);
            $btnSkip.css('opacity', 0.5);
            return this;
        }
        return false;
    };


    self.enableSubmit = function () {
        if (!lock.disableSubmit) {
            status.disableSubmit = false;
            // $btnSubmit.attr('disabled', false);
            $btnSubmit.css('opacity', 1);
            return this;
        }
        return false;
    };


    self.enableSkip = function () {
        if (!lock.disableSkip) {
            status.disableSkip = false;
            // $btnSkip.attr('disabled', false);
            $btnSkip.css('opacity', 1);
            return this;
        }
        return false;
    };

    self.goldenInsertionSubmit = function () {
        // This method allows GoldenInsetion to submit the task.
        return goldenInsertionSubmit();
    };

    self.isPreviewMode = function () {
        // This method returns whether the task is in preview mode or not.
        return properties.isPreviewMode;
    };

    self.lockDisableSubmit = function () {
        lock.disableSubmit = true;
        return this;
    };


    self.lockDisableSkip = function () {
        lock.disableSkip = true;
        return this;
    };

    self.setPreviousLabelingTaskId = function (val) {
        // This method sets the labelingTaskId
        properties.previousLabelingTaskId = val;
        return this;
    };

    self.setTaskDescription = function (val) {
        // This method sets the taskDescription
        properties.taskDescription = val;
        return this;
    };


    self.setTaskRemaining = function (val) {
        // This method sets the number of remaining tasks
        properties.taskRemaining = val;
        return this;
    };

    self.setTaskPanoramaId = function (val) {
        // This method sets the taskPanoramaId. Note it is not same as the GSV panorama id.
        properties.taskPanoramaId = val;
        return this;
    };


    self.unlockDisableSubmit = function () {
        lock.disableSubmit = false;
        return this;
    };


    self.unlockDisableSkip = function () {
        lock.disableSkipButton = false;
        return this;
    };

    self.submit = submit;
    self.compileSubmissionData = compileSubmissionData;
    _init(params);
    return self;
}

var svl = svl || {};

/**
 *
 * @param param {object}
 * @param $ {object} jQuery object
 * @returns {{className: string}}
 * @constructor
 */
function GoldenInsertion (param, $) {
    var oPublic = {
        className: 'GoldenInsertion'
    };
    var properties = {
        cameraMovementDuration: 500, // 500 ms
        curbRampThreshold: 0.35,
        goldenLabelVisibility: 'hidden',
        noCurbRampThreshold: 0.1
    };
    var status = {
        boxMessage: "",
        currentLabel: undefined,
        hasMistake: false,
        revisingLabels: false
    };
    var lock = {};
    var domOKButton = '<button id="GoldenInsertionOkButton" class="button" style="">OK</button>';

    var onboarding; // This variable will hold an onboarding object

    var $buttonCurbRamp;
    var $buttonNoCurbRamp;

    ////////////////////////////////////////////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////////////////////////////////////////////
    function _init (param) {
        if ('goldenLabelVisibility' in param) {
            properties.goldenLabelVisibility = param.goldenLabelVisibility;
        }

        onboarding = new Onboarding(param, $);
        $buttonCurbRamp = $("#ModeSwitchButton_CurbRamp");
        $buttonNoCurbRamp = $("#ModeSwitchButton_NoCurbRamp");
    }

    function clear () {
        // This method clears the object status and cleans up the instruction canvas.
        status.currentLabel = undefined;
        onboarding.clear();
    }

    function clickOK () {
        // This is a callback function that is invoked when a user clicked an OK button on the final message.
        if ('form' in svl && svl.form) {
            svl.form.goldenInsertionSubmit();
        } else {
            throw oPublic.className + ": Cannnot submit without a Form object.";
        }
    }

    function compare(label1, label2) {
        // A comparison function used to sort a list of labels based on its relativeHeading.
        if (label1.relativeHeading < label2.relativeHeading) {
            return -1;
        } else if (label1.relativeHeading > label2.relativeHeading) {
            return 1
        } else {
            return 0;
        }
    }

    function reviseFalseNegative (label) {
        // This method sets the camera angle to a false negative label and asks a user to label it.
        if (('canvas' in svl && svl.canvas) &&
            ('map' in svl && svl.map)) {
            svl.tracker.push('GoldenInsertion_ReviseFalseNegative');
            var labelId = label.getLabelId();
            var systemLabels = svl.canvas.getSystemLabels(true);
            var systemLabelIndex;
            var systemLabelsLength = systemLabels.length;

            //
            // Find a reference to the right user label
            for (systemLabelIndex = 0; systemLabelIndex < systemLabelsLength; systemLabelIndex++) {
                if (labelId == systemLabels[systemLabelIndex].getLabelId()) {
                    label = systemLabels[systemLabelIndex];
                    label.unlockVisibility().setVisibility('visible').lockVisibility();
                    // label.unlockTagVisibility().setTagVisibility('visible').lockTagVisibility();
                } else {
                    systemLabels[systemLabelIndex].unlockVisibility().setVisibility('hidden').lockVisibility();
                    // systemLabels[systemLabelIndex].unlockTagVisibility().setTagVisibility('hidden').lockTagVisibility();
                }
            }

            //
            // Set the pov so the user can see the label.
            var pov = label.getLabelPov();
            var labelType = label.getLabelType();
            status.currentLabel = label;

            if (labelType === "CurbRamp") {
                // status.boxMessage = "You did not label this <b>curb ramp</b>. Please draw an outline around it by clicking the <b>Curb Ramp</b> button.";
                status.boxMessage = "You did not label this <b>curb ramp</b>. Please draw an outline around it.";
            } else {
                // status.boxMessage = "You did not label this <b>missing curb ramp</b>. Please draw an outline around it by clicking the <b>Missing Curb Ramp</b> button.";
                status.boxMessage = "You did not label this <b>missing curb ramp</b>. Please draw an outline around it.";
            }

            svl.messageBox.hide();
            svl.map.setPov(pov, properties.cameraMovementDuration, function () {
                status.currentLabel = label;
                showMessage();
                //
                // Automatically switch to the CurbRamp or NoCurbRamp labeling mode based on the given label type.
                if (labelType === 'CurbRamp') {
                    svl.ribbon.modeSwitch('CurbRamp');
                } else if (labelType === 'NoCurbRamp') {
                    svl.ribbon.modeSwitch('NoCurbRamp');
                }
            });
            var blue = 'rgba(0,0,255, 0.5)';
            label.fill(blue).blink(5); // True is set to fade the color at the end.
        }
    }

    function reviseFalsePositive (label, overlap) {
        // This method sets the camera angle to a false positive label and asks a user to delete the false positive label.
        if (!overlap || typeof overlap !== "number") {
            overlap = 0;
        }
        if (('canvas' in svl && svl.canvas) &&
            ('map' in svl && svl.map)) {
            svl.tracker.push('GoldenInsertion_ReviseFalsePositive');
            var labelId = label.getLabelId();
            var userLabels = svl.canvas.getUserLabels(true);
            var userLabelIndex;
            var userLabelsLength = svl.canvas.getUserLabelCount();

            //
            // Find a reference to the right user label
            for (userLabelIndex = 0; userLabelIndex < userLabelsLength; userLabelIndex++) {
                if (labelId == userLabels[userLabelIndex].getLabelId()) {
                    label = userLabels[userLabelIndex];
                    break;
                }
            }

            //
            // Set the pov so the user can see the label.
            var pov = label.getLabelPov();
            var labelType = label.getLabelType();
            status.currentLabel = label;

            if (labelType === "CurbRamp") {
                // status.boxMessage = "You did not label this <b>curb ramp</b>. Please draw an outline around it by clicking the <b>Curb Ramp</b> button.";
                if (overlap > 0) {
                    status.boxMessage = "This label does not precisely outline the <b>curb ramp</b>. Mouse over the label and click " +
                        "<img src=\"" + svl.rootDirectory + "img/icons/Sidewalk/Icon_Delete.svg\" class=\"MessageBoxIcons\"/> " +
                        "to delete.";
                } else {
                    status.boxMessage = "There does not appear to be a curb ramp to label here. Mouse over the label and click " +
                        "<img src=\"" + svl.rootDirectory + "/img/icons/Sidewalk/Icon_Delete.svg\" class=\"MessageBoxIcons\"/> " +
                        "to delete.";
                }
            } else {
                // status.boxMessage = "You did not label this <b>missing curb ramp</b>. Please draw an outline around it by clicking the <b>Missing Curb Ramp</b> button.";
                if (overlap > 0) {
                    status.boxMessage = "Your label is not on a <b>missing curb ramp</b>. Mouse over the label and click " +
                        "<img src=\"" + svl.rootDirectory + "/img/icons/Sidewalk/Icon_Delete.svg\" class=\"MessageBoxIcons\"/> " +
                        "to delete.";
                } else {
                    status.boxMessage = "There does not appear to be any missing curb ramp to label here. Mouse over the label and click " +
                        "<img src=\"" + svl.rootDirectory + "/img/icons/Sidewalk/Icon_Delete.svg\" class=\"MessageBoxIcons\"/> " +
                        "to delete.";
                }
            }

//            if (labelType === "CurbRamp") {
//                var message = "This label does not precisely outline the curb ramp. Please delete the label by clicking the " +
//                    "<img src=\"public/img/icons/Sidewalk/Icon_Delete.svg\" class=\"MessageBoxIcons\"/> " +
//                    "button and try outlining.";
//            } else {
//                var message = "Your label is not on a missing curb ramp. Please delete the label by clicking " +
//                    "<img src=\"public/img/icons/Sidewalk/Icon_Delete.svg\" class=\"MessageBoxIcons\"/> " +
//                    "on the label.";
//            }

            //
            // Change the pov, then invoke a callback function to show an message.
            // Ask an user to delete the label that is wrong.
            // Keep checking if the user deleted the label or not by counting the number of user labels.
            // Move on once the user have corrected the mistake.
            svl.messageBox.hide();
            svl.map.setPov(pov, properties.cameraMovementDuration, function () {
                status.currentLabel = label;
                showMessage();
            });
            // label.highlight().blink(5, true); // The second argument is set to true so the label will fade at the end.
            var red = 'rgba(255, 0, 0, 0.7)';
            label.fill(red).blink(5);
        }
    }

    function reviewLabels () {
        // Deprecated. Use reviewLabels2
        // This method reviews if user provided labels align well with system provided (golden/ground truth) labels.
        // This method extract system labels and user labels from svl.canvas, then compares overlap.
        // Finally it returns the number of mistakes identified.
        if (('canvas' in svl && svl.canvas) &&
            ('form' in svl && svl.form) &&
            ('map' in svl && svl.map)) {
            var userLabels = svl.canvas.getLabels('user');
            var systemLabels = svl.canvas.getLabels('system');
            var userLabelIndex;
            var systemLabelIndex;

            //
            // Clear anything from previous review.
            clear();

            //
            // Filter user labels
            userLabels = userLabels.filter(function (label) {
                return !label.isDeleted() && label.isVisible();
            });

            var userLabelsLength = svl.canvas.getUserLabelCount();
            var systemLabelsLength = systemLabels.length;
            var falseNegativeLabels = []; // This array stores ids of missed system labels.
            var falsePositiveLabels = []; // This array stores ids of false user labels.

            var overlap;
            var labelType;
            var doesOverlap;

            //
            // Check if a user has labeled something that is not a curb ramp or not a missing curb ramp (False positive)
            for (userLabelIndex = 0; userLabelIndex < userLabelsLength; userLabelIndex++) {
                overlap = 0;
                doesOverlap = false;
                for (systemLabelIndex = 0; systemLabelIndex < systemLabelsLength; systemLabelIndex++) {
                    if (!userLabels[userLabelIndex].isDeleted() && userLabels[userLabelIndex].isVisible()) {
                        if (userLabels[userLabelIndex].getLabelType() == systemLabels[systemLabelIndex].getLabelType()) {
                            overlap = userLabels[userLabelIndex].overlap(systemLabels[systemLabelIndex]);
                            labelType = userLabels[userLabelIndex].getLabelType();
                            if (labelType == "CurbRamp" && overlap > properties.curbRampThreshold) {
                                doesOverlap = true;
                                break;
                            } else if (labelType == "NoCurbRamp" && overlap > properties.noCurbRampThreshold) {
                                doesOverlap = true;
                                break;
                            }
                        }
                    }
                }
                if (!doesOverlap) {
                    falsePositiveLabels.push(userLabels[userLabelIndex]);
                }
            }

            //
            // Check if a user has missed to label some of system labels (False negatives)
            for (systemLabelIndex = 0; systemLabelIndex < systemLabelsLength; systemLabelIndex++) {
                overlap = 0;
                doesOverlap = false;
                for (userLabelIndex = 0; userLabelIndex < userLabelsLength; userLabelIndex++) {
                    if (!userLabels[userLabelIndex].isDeleted() && userLabels[userLabelIndex].isVisible()) {

                        if (userLabels[userLabelIndex].getLabelType() == systemLabels[systemLabelIndex].getLabelType()) {
                            overlap = userLabels[userLabelIndex].overlap(systemLabels[systemLabelIndex]);
                            labelType = userLabels[userLabelIndex].getLabelType();
                            if (labelType == "CurbRamp" && overlap > properties.curbRampThreshold) {
                                doesOverlap = true;
                                break;
                            } else if (labelType == "NoCurbRamp" && overlap > properties.noCurbRampThreshold) {
                                doesOverlap = true;
                                break;
                            }
                        }
                    }
                }
                if (!doesOverlap) {
                    falseNegativeLabels.push(systemLabels[systemLabelIndex]);
                }
            }

            //
            // Walk through the mistakes if there are any mistakes
            var numFalseNegatives = falseNegativeLabels.length;
            var numFalsePositives = falsePositiveLabels.length;
            var numMistakes = numFalseNegatives + numFalsePositives;
            if (numMistakes > 0) {
                status.hasMistake = true;
                if (numFalsePositives > 0) {
                    reviseFalsePositive(falsePositiveLabels[0]);
                } else if (numFalseNegatives > 0) {
                    reviseFalseNegative(falseNegativeLabels[0]);
                }
                return numMistakes;
            } else {
                // Change the message depending on whether s/he has made a misatke or not.
                var domSpacer = "<div style='height: 10px'></div>"
                if (status.hasMistake) {
                    var message = "Great, you corrected all the mistakes! Now, let's move on to the next task. " +
                        "Please try to be as accurate as possible. Your labels will be used to make our cities better " +
                        "and more accessible.<br/>" + domSpacer + domOKButton;
                } else {
                    var message = "Fantastic! You labeled everything correctly! Let's move on to the next task. <br />" + domSpacer + domOKButton;
                }
                var messageBoxX = 0;
                var messageBoxY = 320;
                var width = 720;
                var height = null;
                svl.messageBox.setMessage(message).setPosition(messageBoxX, messageBoxY, width, height, true).show();
                $("#GoldenInsertionOkButton").bind('click', clickOK);
                return 0;
            }
        }
        return false;
    }

    function reviewLabels2 () {
        // This method reviews if user provided labels align well with system provided (golden/ground truth) labels.
        // This method extract system labels and user labels from svl.canvas, then compares overlap.
        if (('canvas' in svl && svl.canvas) &&
            ('form' in svl && svl.form) &&
            ('map' in svl && svl.map) &&
            ('panorama' in svl && svl.panorama)) {
            svl.tracker.push('GoldenInsertion_ReviewLabels');
            var userLabels = svl.canvas.getLabels('user');
            var systemLabels = svl.canvas.getLabels('system');
            var allLabels = [];
            var userLabelIndex;
            var systemLabelIndex;

            //
            // Clear anything from previous review.
            clear();

            //
            // Filter user labels
            userLabels = userLabels.filter(function (label) {
                return !label.isDeleted() && label.isVisible();
            });


            var _userLabels = userLabels.map(function (label) {
                label.labeledBy = "user";
                return label;
            });
            var _systemLabels = systemLabels.map(function (label) {
                label.labeledBy = "system";
                return label;
            });
            var allLabels = _userLabels.concat(_systemLabels);
            allLabels = allLabels.map(function (label) {
                var currentHeading = svl.panorama.getPov().heading;
                var labelHeading = label.getLabelPov().heading; //label.//label.getProperty("panoramaHeading");
                var weight = 10; // Add a weight to system labels so they tend to be corrected after correcting user labels.
                label.relativeHeading = parseInt((labelHeading - currentHeading + 360) % 360);
                label.relativeHeading = (label.relativeHeading < 360 - label.relativeHeading) ? label.relativeHeading : 360 - label.relativeHeading;
                label.relativeHeading = (label.labeledBy === "system") ? label.relativeHeading + weight : label.relativeHeading;
                return label;
            });
            //
            // Sort an array of objects by values of the objects
            // http://stackoverflow.com/questions/1129216/sorting-objects-in-an-array-by-a-field-value-in-javascript
            allLabels.sort(compare);


            var overlap;


            //
            // Check if the user has labeled curb ramps and missing curb ramps correctly.
            var allLabelsLength = allLabels.length;
            var i;
            var j;
            var len;
            var correctlyLabeled;
            for (i = 0; i < allLabelsLength; i++) {
                if (("correct" in allLabels[i]) && allLabels[i]["correct"]) {
                    continue;
                } else {
                    correctlyLabeled = false;
                    var maxOverlap = 0;
                    if (allLabels[i].labeledBy === "user") {
                        // compare the user label with all the system labels to see if it is a true positive label.
                        len = systemLabels.length;
                        for (j = 0; j < len; j++) {
                            if (allLabels[i].getLabelType() === systemLabels[j].getLabelType()) {
                                overlap = allLabels[i].overlap(systemLabels[j]);

                                if (overlap > maxOverlap) {
                                    maxOverlap = overlap;
                                }


                                if ((allLabels[i].getLabelType() === "CurbRamp" && overlap > properties.curbRampThreshold) ||
                                    (allLabels[i].getLabelType() === "NoCurbRamp" && overlap > properties.noCurbRampThreshold)) {
                                    allLabels[i].correct = true;
                                    systemLabels[j].correct = true;
                                    correctlyLabeled = true;
                                    break;
                                }
                            }
                        }
                        if (!correctlyLabeled) {
                            if (!status.hasMistake) {
                                // Before moving on to the correction phase, show a message that tells
                                // the user we will guide them to correct labels.
                                showPreLabelCorrectionMesseage(reviseFalsePositive, {label: allLabels[i], overlap: maxOverlap});
                                status.hasMistake = true;
                            } else {
                                reviseFalsePositive(allLabels[i], maxOverlap);
                            }
                            return;
                        }
                    } else {
                        // Compare the system label with all the user labels to see if the user has missed to label this
                        // this system label.
                        len = userLabels.length;
                        for (j = 0; j < len; j++) {
                            if (allLabels[i].getLabelType() === userLabels[j].getLabelType()) {
                                overlap = allLabels[i].overlap(userLabels[j]);
                                if ((allLabels[i].getLabelType() === "CurbRamp" && overlap > properties.curbRampThreshold) ||
                                    (allLabels[i].getLabelType() === "NoCurbRamp" && overlap > properties.noCurbRampThreshold)) {
                                    allLabels[i].correct = true;
                                    userLabels[j].correct = true;
                                    correctlyLabeled = true;
                                    break;
                                }
                            }
                        }
                        if (!correctlyLabeled) {
                            if (!status.hasMistake) {
                                // Before moving on to the correction phase, show a message that tells
                                // the user we will guide them to correct labels.
                                showPreLabelCorrectionMesseage(reviseFalseNegative, {label: allLabels[i]});
                                status.hasMistake = true;
                            } else {
                                reviseFalseNegative(allLabels[i]);
                            }
                            return;
                        }
                    }
                }
            }

            //
            // Change the message depending on whether s/he has made a misatke or not.
            var domSpacer = "<div style='height: 10px'></div>"
            if (status.hasMistake) {
                var message = "Great, you corrected all the mistakes! Please try to be as accurate as possible. " +
                    "Your labels will be used to make our cities better and more accessible." +
                    "Now, let's move on to the next task. <br/>" + domSpacer + domOKButton;
            } else {
                var message = "Fantastic! You labeled everything correctly! Let's move on to the next task. <br />" + domSpacer + domOKButton;
            }
            var messageBoxX = 0;
            var messageBoxY = 320;
            var width = 700;
            var height = null;
            svl.messageBox.setMessage(message).setPosition(messageBoxX, messageBoxY, width, height, true).show();
            $("#GoldenInsertionOkButton").bind('click', clickOK);
            return;
        }
        return;
    }

    function showMessage() {
        // Show a message and ask an user to provide a label the label they missed to label.
        // Keep checking if they provided a new label or not. Until they provide the label, disable submit.
        // Once they provide a label, review other labels.
        //
        // This method assumes that status.currentLabel and status.boxMessage are set.
        onboarding.clear();

        var boundingbox = status.currentLabel.getBoundingBox();
        var messageBoxX = boundingbox.x + boundingbox.width + 50;
        var messageBoxY = boundingbox.y + boundingbox.height / 2 + 60;
        svl.messageBox.setMessage(status.boxMessage).setPosition(messageBoxX, messageBoxY).show();

        //
        // Show a "click here" message and bind events to mode switch buttons.

        // onboarding.renderArrow(x, y - 50, x, y - 20, {arrowWidth: 3});
        onboarding.renderArrow(messageBoxX, boundingbox.y + boundingbox.height / 2 + 10, messageBoxX - 25, boundingbox.y + (boundingbox.height / 2), {arrowWidth: 3});
        // onboarding.renderArrow(messageBoxX, y - 50, messageBoxX - 25, y - 80, {arrowWidth: 3});
        // onboarding.renderCanvasMessage(x - (boundingbox.width / 2) - 150, y - 60, "Trace an outline similar to this one.", {fontSize: 18, bold: true});
    }

    function showPreLabelCorrectionMesseage(callback, params) {
        // Before moving on to the correction phase, show a message that tells
        // the user we will guide them to correct labels.
        if (!params) {
            return false;
        }
        if (!("label" in params) || !params.label) {
            return false;
        }

        var domSpacer = "<div style='height: 10px'></div>"
        var message = "<img src=\"" + svl.rootDirectory + "/img/icons/Icon_WarningSign.svg\" class=\"MessageBoxIcons\" style=\"height:30px; width:30px; top:6px;\"/> " +
            "Uh oh, looks like there is a problem with your labels. Let's see if we can fix this. <br />" + domSpacer + domOKButton;
        var messageBoxX = 0;
        var messageBoxY = 320;
        var width = 720;
        var height = null;
        svl.messageBox.setMessage(message).setPosition(messageBoxX, messageBoxY, width, height, true).show();
        $("#GoldenInsertionOkButton").bind('click', function () {
            svl.messageBox.hide();
            if ("overlap" in params) {
                callback(params.label, params.overlap);
            } else {
                callback(params.label);
            }
        });
    }


    ////////////////////////////////////////////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////////////////////////////////////////////
    oPublic.disableOkButton = function () {
        // This method disables the OK button.
        $("#GoldenInsertionOkButton").unbind('click');
        $("#GoldenInsertionOkButton").css('opacity', 0.7);
    };

    oPublic.getGoldenLabelVisibility = function () {
        // This method returns the visibility of golden labels.
        return properties.goldenLabelVisibility;
    };

    oPublic.isRevisingLabels = function () {
        // This function is called in Canvas to check whether the user should be revising
        // the false labels. See removeLabel amd closePath methods.
        return status.revisingLabels;
    };

    oPublic.renderMessage = function () {
        // This is a function that is executed from Map.js's viewControlLayerMouseMove()
        if (status.currentLabel && status.boxMessage !== "") {
            showMessage();
        }
        return;
    };

    oPublic.reviewLabels = function () {
        status.revisingLabels = true;
        return reviewLabels2();
    };

    _init(param);
    return oPublic;
}

svl.formatRecordsToGoldenLabels = function (records) {
    // This method takes records from database and format it into labels that the Canvas object can read.
    var i;
    var goldenLabels = {};
    var recordsLength = records.length;

    //
    // Group label points by label id
    var labelId;
    var panoId;
    var lat;
    var lng;
    var deleted;
    for (i = 0; i < recordsLength; i++) {
        //
        // Set pano id
        if ('LabelGSVPanoramaId' in records[i]) {
            panoId = records[i].LabelGSVPanoramaId;
        } else if ('GSVPanoramaId' in records[i]) {
            panoId = records[i].GSVPanoramaId;
        } else {
            panoId = undefined;
        }

        //
        // set latlng
        if ('Lat' in records[i]) {
            lat = records[i].Lat;
        } else if ('labelLat' in records[i]) {
            lat = records[i].labelLat;
        } else {
            lat = undefined;
        }
        if ('Lng' in records[i]) {
            lng = records[i].Lng;
        } else if ('labelLng' in records[i]) {
            lng = records[i].labelLng;
        } else {
            lng = undefined;
        }

        if (records[i].Deleted != "1") {
            labelId = records[i].LabelId;
            if (!(labelId in goldenLabels)) {
                goldenLabels[labelId] = [];
            }

            var temp = {
                AmazonTurkerId: records[i].AmazonTurkerId,
                LabelId: records[i].LabelId,
                LabelGSVPanoramaId: panoId,
                LabelType: records[i].LabelType,
                LabelPointId: records[i].LabelPointId,
                svImageX: records[i].svImageX,
                svImageY: records[i].svImageY,
                originalCanvasCoordinate: {x: records[i].originalCanvasX, y: records[i].originalCanvasY},
                originalHeading: records[i].originalHeading,
                originalPitch: records[i].originalPitch,
                originalZoom: records[i].originalZoom,
                heading: records[i].heading,
                pitch: records[i].pitch,
                zoom: records[i].zoom,
                Lat: lat,
                Lng: lng
            };

            if ('PhotographerHeading' in records[i] && 'PhotographerPitch' in records[i]) {
                temp.PhotographerHeading = parseFloat(records[i].PhotographerHeading);
                temp.PhotographerPitch = parseFloat(records[i].PhotographerPitch);
            }
            goldenLabels[labelId].push(temp);
        }
    }

    var ret = [];
    for (labelId in goldenLabels) {
        ret.push(goldenLabels[labelId]);
    }
    return ret;
};

svl.formatRecordsToLabels = svl.formatRecordsToGoldenLabels;

var svl = svl || {};

/**
 * A Keyboard module
 * @param $
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
    var $taskDifficultyComment;
    var $inputSkipOther;

    function init () {
        if ('ui' in svl && 'form' in svl.ui) {
            $textareaComment = (svl.ui.form.commentField.length) > 0 ? svl.ui.form.commentField : null;
        }
        $taskDifficultyComment = ($("#task-difficulty-comment").length > 0) ? $("#task-difficulty-comment") : null;
        $inputSkipOther = ($("#Text_BusStopAbsenceOtherReason").length > 0) ? $("#Text_BusStopAbsenceOtherReason") : null;

        if ($textareaComment) {
          $textareaComment.bind('focus', textFieldFocus);
          $textareaComment.bind('blur', textFieldBlur);
        }

        if ($taskDifficultyComment) {
            $taskDifficultyComment.bind('focus', textFieldFocus);
            $taskDifficultyComment.bind('blur', textFieldBlur);
        }

        if ($inputSkipOther) {
          $inputSkipOther.bind('focus', textFieldFocus);
          $inputSkipOther.bind('blur', textFieldBlur);
        }

        $(document).bind('keyup', documentKeyUp);
        $(document).bind('keydown', documentKeyDown);
    }

    function documentKeyDown(e) {
        // The callback method that is triggered with a keyUp event.
        if (!status.focusOnTextField) {
          if ('tracker' in svl) {
            svl.tracker.push('KeyDown', {'keyCode': e.keyCode});
          }
            switch (e.keyCode) {
                case 16:
                    // "Shift"
                    status.shiftDown = true;
                    break;
            }
        }
    }

    /**
     * This method is fired with keyup.
     * @param e
     */
    function documentKeyUp (e) {
        // console.log(e.keyCode);

        // This is a callback method that is triggered when a keyDown event occurs.
        if (!status.focusOnTextField) {
          if ('tracker' in svl) {
            svl.tracker.push('KeyUp', {'keyCode': e.keyCode});
          }
            switch (e.keyCode) {
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
                    svl.ribbon.modeSwitchClick("CurbRamp");
                    break;
                case 50:
                    // "2"
                    svl.ribbon.modeSwitchClick("NoCurbRamp");
                    break;
                case 51:
                    // "3"
                    svl.ribbon.modeSwitchClick("Obstacle");
                    break;
                case 52:
                    // "4"
                    svl.ribbon.modeSwitchClick("SurfaceProblem");
                    break;
                case 67:
                    // "c" for CurbRamp. Switch the mode to the CurbRamp labeling mode.
                    svl.ribbon.modeSwitchClick("CurbRamp");
                    break
                case 69:
                    // "e" for Explore. Switch the mode to Walk (camera) mode.
                    svl.ribbon.modeSwitchClick("Walk");
                    break;
                case 77:
                    // "m" for MissingCurbRamp. Switch the mode to the MissingCurbRamp labeling mode.
                    svl.ribbon.modeSwitchClick("NoCurbRamp");
                    break;
                case 79:
                    // "o" for Obstacle
                    svl.ribbon.modeSwitchClick("Obstacle");
                    break;
                case 83:
                    svl.ribbon.modeSwitchClick("SurfaceProblem");
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


    function textFieldBlur () {
        // This is a callback function called when any of the text field is blurred.
        status.focusOnTextField = false
    }

    function textFieldFocus () {
        // This is a callback function called when any of the text field is focused.
        status.focusOnTextField = true;
    }

    self.getStatus = function (key) {
        if (!(key in status)) {
          console.warn("You have passed an invalid key for status.")
        }
        return status[key];
    };

    self.isShiftDown = function () {
        // This method returns whether a shift key is currently pressed or not.
        return status.shiftDown;
    };

    self.setStatus = function (key, value) {
      if (key in status) {
        status[key] = value;
      }
      return this;
    };

    init();
    return self;
}

var svl = svl || {};

/**
 * A Label module.
 * @param pathIn
 * @param params
 * @returns {*}
 * @constructor
 * @memberof svl
 */
function Label (pathIn, params) {
    var self = {
        className: 'Label'
    };

    var path;
    var googleMarker;

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
        tagY: -1
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

    function init (param, pathIn) {
        try {
            if (!pathIn) {
                var errMsg = 'The passed "path" is empty.';
                throw errMsg;
            } else {
                path = pathIn;
            }

            for (var attrName in properties) {
                // It is ok if some attributes are not passed as parameters
                if ((attrName === 'tagHeight' ||
                     attrName === 'tagWidth' ||
                     attrName === 'tagX' ||
                     attrName === 'tagY' ||
                     attrName === 'labelerId' ||
                     attrName === 'photographerPov' ||
                     attrName === 'photographerHeading' ||
                     attrName === 'photographerPitch' ||
                            attrName === 'distanceThreshold'
                    ) &&
                    !param[attrName]) {
                    continue;
                }

                properties[attrName] = param[attrName];
            }

            // Set belongs to of the path.
            path.setBelongsTo(self);

            googleMarker = createGoogleMapsMarker(param.labelType);
            googleMarker.setMap(svl.map.getMap());
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
        var path = self.getPath();
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

                self.setAlpha(0.05);
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

    /**
     * This method turn the associated Path and Points into gray.
     * @param mode
     * @returns {fadeFillStyle}
     */
    function fadeFillStyle (mode) {
        var path = self.getPath(),
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
        var path = self.getPath(),
            points = path.getPoints(),
            len = points.length;

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
        var path = self.getPath();
        return path.getBoundingBox(pov);
    }

    /**
     * This function returns the coordinate of a point.
     * @returns {*}
     */
    function getCoordinate () {
        if (path && path.points.length > 0) {
            var pov = path.getPOV();
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
     *
     * @returns {*}
     */
    function getImageCoordinates () { return path ? path.getImageCoordinates() : false; }

    /**
     * This function returns labelId property
     * @returns {string}
     */
    function getLabelId () { return properties.labelId; }

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
            points = self.getPoints(),
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
    function highlight () { return self.fill('rgba(255,165,0,0.8)'); }

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
    function isVisible () { return status.visibility === 'visible'; }

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
        if (!mode) {
            mode = "boundingbox";
        }

        if (mode !== "boundingbox") {
            throw self.className + ": " + mobede + " is not a valid option.";
        }
        var path1 = self.getPath(),
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
                    if (!evaluationMode) {
                        renderTag(ctx);
                        path.renderBoundingBox(ctx);
                        showDelete();
                        //showDelete(path);
                    }
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
        if (arguments.length !== 3) {
            return false;
        }
        var boundingBox = path.getBoundingBox();
        var msg = properties.labelDescription;
        var messages = msg.split('\n');

        if (properties.labelerId !== 'DefaultValue') {
            messages.push('Labeler: ' + properties.labelerId);
        }

        ctx.font = '10.5pt Calibri';
        var height = properties.tagHeight * messages.length;
        var width = -1;
        for (var i = 0; i < messages.length; i += 1) {
            var w = ctx.measureText(messages[i]).width + 5;
            if (width < w) {
                width = w;
            }
        }
        properties.tagWidth = width;

        var tagX;
        var tagY;
        ctx.save();
        ctx.lineWidth = 3.5;
        ctx.fillStyle = 'rgba(255,255,255,1)';
        ctx.strokeStyle = 'rgba(255,255,255,1)';
        ctx.beginPath();
        var connectorX = 15;
        if (connectorX > boundingBox.width) {
            connectorX = boundingBox.width - 1;
        }

        if (boundingBox.x < 5) {
            tagX = 5;
        } else {
            tagX = boundingBox.x;
        }

        if (boundingBox.y + boundingBox.height < 400) {
            ctx.moveTo(tagX + connectorX, boundingBox.y + boundingBox.height);
            ctx.lineTo(tagX + connectorX, boundingBox.y + boundingBox.height + 10);
            ctx.stroke();
            ctx.closePath();
            ctx.restore();
            tagY = boundingBox.y + boundingBox.height + 10;
        } else {
            ctx.moveTo(tagX + connectorX, boundingBox.y);
            ctx.lineTo(tagX + connectorX, boundingBox.y - 10);
            ctx.stroke();
            ctx.closePath();
            ctx.restore();
            // tagX = boundingBox.x;
            tagY = boundingBox.y - height - 20;
        }


        var r = 3;
        var paddingLeft = 16;
        var paddingRight = 30;
        var paddingBottom = 10;

        // Set rendering properties
        ctx.save();
        ctx.lineCap = 'square';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // point.getProperty('fillStyleInnerCircle');
        ctx.strokeStyle = 'rgba(255,255,255,1)'; // point.getProperty('strokeStyleOuterCircle');
        //point.getProperty('lineWidthOuterCircle');

        // Draw a tag
        ctx.beginPath();
        ctx.moveTo(tagX, tagY);
        ctx.lineTo(tagX + width + paddingLeft + paddingRight, tagY);
        ctx.lineTo(tagX + width + paddingLeft + paddingRight, tagY + height + paddingBottom);
        ctx.lineTo(tagX, tagY + height + paddingBottom);
        ctx.lineTo(tagX, tagY);
//        ctx.moveTo(tagX, tagY - r);
//        ctx.lineTo(tagX + width - r, tagY - r);
//        ctx.arc(tagX + width, tagY, r, 3 * Math.PI / 2, 0, false); // Corner
//        ctx.lineTo(tagX + width + r, tagY + height - r);
//        ctx.arc(tagX + width, tagY + height, r, 0, Math.PI / 2, false); // Corner
//        ctx.lineTo(tagX + r, tagY + height + r);
//        ctx.arc(tagX, tagY + height, r, Math.PI / 2, Math.PI, false); // Corner
//        ctx.lineTo(tagX - r, tagY); // Corner

        ctx.fill();
        ctx.stroke()
        ctx.closePath();
        ctx.restore();

        // Render an icon and a message
        ctx.save();
        ctx.fillStyle = '#000';
        var labelType = properties.labelType;
        var iconImagePath = getLabelIconImagePath()[labelType].iconImagePath;
        var imageObj;
        var imageHeight;
        var imageWidth;
        var imageX;
        var imageY;
        imageObj = new Image();
        imageHeight = imageWidth = 25;
        imageX =  tagX + 5;
        imageY = tagY + 2;

        //imageObj.onload = function () {

        ///            };
        // ctx.globalAlpha = 0.5;
        imageObj.src = iconImagePath;
        ctx.drawImage(imageObj, imageX, imageY, imageHeight, imageWidth);

        for (var i = 0; i < messages.length; i += 1) {
            ctx.fillText(messages[i], tagX + paddingLeft + 20, tagY + 20 + 20 * i);
        }
        // ctx.fillText(msg, tagX, tagY + 17);
        ctx.restore();

        return;
    }



    /**
     * This method turn the fill color of associated Path and Points into their original color.
     * @returns {resetFillStyle}
     */
    function resetFillStyle () {
        var path = self.getPath(),
            points = path.getPoints(),
            len = points.length;
        path.resetFillStyle();
        for (var i = 0; i < len; i++) {
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
        var path = self.getPath(),
            points = path.getPoints(),
            len = points.length,
            fillColor = path.getFillStyle();
        fillColor = svl.util.color.changeAlphaRGBA(fillColor, 0.3);

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
            if (key === 'visibility' &&
                (value === 'visible' || value === 'hidden')) {
                // status[key] = value;
                self.setVisibility(value);
            } else if (key === 'tagVisibility' &&
                (value === 'visible' || value === 'hidden')) {
                self.setTagVisibility(value);
            } else if (key === 'deleted' && typeof value === 'boolean') {
                status[key] = value;
            }
        }
    }

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
        var labelDescriptions = getLabelDescriptions(),
            labelDescription = labelDescriptions[labelType].text;
        properties.labelProperties.subLabelDescription = labelDescription;
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
                self.unlockVisibility().setVisibility(visibility).lockVisibility();
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                self.unlockVisibility().setVisibility(visibility).lockVisibility();
            }
        } else {
            if (included) {
                if (labelerIds.indexOf(properties.labelerId) !== -1) {
                    self.unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            } else {
                if (labelerIds.indexOf(properties.labelerId) === -1) {
                    self.unlockVisibility().setVisibility(visibility).lockVisibility();
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

    function setVisibilityBasedOnLocation (visibility, panoId) {
        if (!status.deleted) {
            if (panoId === properties.panoId) {
                // self.setStatus('visibility', visibility);
                self.setVisibility(visibility);
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                // self.setStatus('visibility', visibility);
                self.setVisibility(visibility);
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
                self.unlockVisibility().setVisibility(visibility).lockVisibility();
            } else {
                visibility = visibility === 'visible' ? 'hidden' : 'visible';
                self.unlockVisibility().setVisibility(visibility).lockVisibility();
            }
        } else {
            if (included) {
                if (matched) {
                    self.unlockVisibility().setVisibility(visibility).lockVisibility();
                }
            } else {
                if (!matched) {
                    self.unlockVisibility().setVisibility(visibility).lockVisibility();
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
            var $divHolderLabelDeleteIcon = $("#Holder_LabelDeleteIcon");
            $divHolderLabelDeleteIcon.css({
                visibility: 'visible',
                left : x, // + width - 5,
                top : y
            });
        }
    }

    function toOffset() {
        var imageCoordinates = path.getImageCoordinates();
        var lat = properties.panoramaLat;
        var pc = svl.pointCloud.getPointCloud(properties.panoId);
        if (pc) {
            var minDx = 1000;
            var minDy = 1000;
            var minDz = 1000;
            for (var i = 0; i < imageCoordinates.length; i++) {
                var p = svl.util.scaleImageCoordinate(imageCoordinates[i].x, imageCoordinates[i].y, 1 / 26);
                var idx = 3 * (Math.ceil(p.x) + 512 * Math.ceil(p.y));
                var dx = pc.pointCloud[idx];
                var dy = pc.pointCloud[idx + 1];
                var dz = pc.pointCloud[idx + 2];
                var r = dx * dx + dy * dy;
                var minR = minDx * minDx + minDy + minDy;

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
     * @returns {lat: labelLat, lng: labelLng}
     */
    function toLatLng() {
        if (!properties.labelLat) {
            var imageCoordinates = path.getImageCoordinates();
            var lat = properties.panoramaLat;
            var pc = svl.pointCloud.getPointCloud(properties.panoId);
            if (pc) {
                var minDx = 1000;
                var minDy = 1000;
                var delta;
                for (var i = 0; i < imageCoordinates.length; i ++) {
                    var p = svl.util.scaleImageCoordinate(imageCoordinates[i].x, imageCoordinates[i].y, 1/26);
                    var idx = 3 * (Math.ceil(p.x) + 512 * Math.ceil(p.y));
                    var dx = pc.pointCloud[idx];
                    var dy = pc.pointCloud[idx + 1];
                    var r = dx * dx + dy * dy;
                    var minR = minDx * minDx + minDy + minDy;

                    if ( r < minR) {
                        minDx = dx;
                        minDy = dy;

                    }
                }
                delta = svl.util.math.latlngOffset(properties.panoramaLat, dx, dy);
                var latlng = {lat: properties.panoramaLat + delta.dlat, lng: properties.panoramaLng + delta.dlng};
                setProperty('labelLat', latlng.lat);
                setProperty('labelLng', latlng.lng);
                return latlng;
            } else {
                return null;
            }
        } else {
            return { lat: getProperty('labelLat'), lng: getProperty('labelLng') };
        }

    }

    function unlockVisibility () {
        lock.visibility = false;
        return this;
    }

    function unlockTagVisibility () {
        lock.tagVisibility = false;
        return this;
    }


    self.resetFillStyle = resetFillStyle;
    self.blink = blink;
    self.fadeFillStyle = fadeFillStyle;
    self.getBoundingBox = getBoundingBox;
    self.getCoordinate = getCoordinate;
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

    if (!init(params, pathIn)) {
        return false;
    }
    return self;
}

var svl = svl || {};

/**
 * LabelContainer class constructor
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
var svl = svl || {};

/**
 * LabelCounter class constructor
 */
function LabelCounter ($, d3) {
    var self = {className: 'LabelCounter'};

    var radius = 0.4, dR = radius / 2,
        svgWidth = 800, svgHeight = 200,
        margin = {top: 10, right: 10, bottom: 10, left: 0},
        padding = {left: 5, top: 15},
        width = 200 - margin.left - margin.right,
        height = 40 - margin.top - margin.bottom,
        colorScheme = svl.misc.getLabelColors();

    // Prepare a group to store svg elements, and declare a text
    var dotPlots = {
      "CurbRamp": {
        id: "CurbRamp",
        description: "Curb Ramp",
        left: margin.left,
        top: margin.top,
        fillColor: colorScheme["CurbRamp"].fillStyle,
        count: 0,
        data: []
      },
      "NoCurbRamp": {
        id: "NoCurbRamp",
        description: "Missing Curb Ramp",
        left: margin.left,
        top: 2 * margin.top + margin.bottom + height,
        fillColor: colorScheme["NoCurbRamp"].fillStyle,
        count: 0,
        data: []
      },
      "Obstacle": {
        id: "Obstacle",
        description: "Obstacle in Path",
        left: margin.left,
        top: 3 * margin.top + 2 * margin.bottom + 2 * height,
        fillColor: colorScheme["Obstacle"].fillStyle,
        count: 0,
        data: []
      },
      "SurfaceProblem": {
        id: "SurfaceProblem",
        description: "Surface Problem",
        left: margin.left,
        top: 4 * margin.top + 3 * margin.bottom + 3 * height,
        fillColor: colorScheme["SurfaceProblem"].fillStyle,
        count: 0,
        data: []
      }
    };

    var x = d3.scale.linear()
              .domain([0, 20])
              .range([0, width]);

    var y = d3.scale.linear()
            .domain([0, 20])
            .range([height, 0]);

    var svg = d3.select('#label-counter')
                  .append('svg')
                  .attr('width', svgWidth)
                  .attr('height', svgHeight)


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
      dotPlots[key].plot = dotPlots[key].g.append("g")
        .attr('transform', 'translate(' + padding.left + ',' + padding.top + ')');

      dotPlots[key].label = dotPlots[key].g.selectAll("text.label")
        .data([0])
        .enter()
        .append("text")
        .text(function () { return dotPlots[key].description; })
        .style("font-size", "11px")
        .attr("class", "visible");

      dotPlots[key].countLabel = dotPlots[key].plot.selectAll("text.count-label")
        .data([0])
        .enter()
        .append("text")
        .style("font-size", "11px")
        .style("fill", "gray")
        .attr("class", "visible");
    }

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
        var firstDigit = dotPlots[key].count % 10,
          higherDigits = (dotPlots[key].count - firstDigit) / 10,
          count = firstDigit + higherDigits;

        // Update the label
        dotPlots[key].countLabel
          .transition().duration(1000)
          .attr("x", function () {
            return x(higherDigits * 2 * (radius + dR) + firstDigit * 2 * radius)
          })
          .attr("y", function () {
            return x(radius + dR - 0.05);
          })
          // .transition().duration(1000)
          .text(function (d) {
            return dotPlots[key].count;
          });

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
      }
    }


    /**  Decrement the label count */
    function decrement(key) {
        if (key in dotPlots && dotPlots[key].count > 0) {
            dotPlots[key].count -= 1;
        }
        update(key);
    }
    /** Increment the label count */
    function increment(key) {
        if (key in dotPlots) {
            dotPlots[key].count += 1;
            update(key);
        }
    }

    /**
     * Set the number of label count
     */
    function set(key, num) {
        dotPlots[key].count = num;
        update(key);
    }

    // Initialize
    update();

    self.increment = increment;
    self.decrement = decrement;
    self.set = set;
    return self;
}
function LabelFactory () {
    var self = { className: "LabelFactory"},
        temporaryLabelId = 1;

    function create (path, param) {
        var label = new Label(path, param);
        if (!('labelId' in param)) {
            label.setProperty("temporary_label_id", temporaryLabelId);
            temporaryLabelId++;
        }
        return label;
    }

    self.create = create;
    return self;
}
var svl = svl || {};

/**
 * A LabelLandmarkFeedback module
 * @param $ {object} jQuery object
 * @param params {object} Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabeledLandmarkFeedback ($, params) {
    var self = { className : 'LabeledLandmarkFeedback' };
    var properties = {};
    var status = {};

    // jQuery eleemnts
    var $labelCountCurbRamp;
    var $labelCountNoCurbRamp;
    var $submittedLabelMessage;

    ////////////////////////////////////////////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////////////////////////////////////////////
    function _init (params) {
      //
      // Initialize the jQuery DOM elements
      if (svl.ui && svl.ui.ribbonMenu) {
        $labelCountCurbRamp = svl.ui.labeledLandmark.curbRamp;
        $labelCountNoCurbRamp = svl.ui.labeledLandmark.noCurbRamp;
        $submittedLabelMessage = svl.ui.labeledLandmark.submitted;

        $labelCountCurbRamp.html(0);
        $labelCountNoCurbRamp.html(0);
      }
    }


    ////////////////////////////////////////////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////////////////////////////////////////////
    self.setLabelCount = function (labelCount) {
        // This method takes labelCount object that holds label names with
        // corresponding label counts. This function sets the label counts
        // that appears in the feedback window.
        if (svl.ui && svl.ui.ribbonMenu) {
          $labelCountCurbRamp.html(labelCount['CurbRamp']);
          $labelCountNoCurbRamp.html(labelCount['NoCurbRamp']);
        }
        return this;
    };

    self.setSubmittedLabelMessage = function (param) {
        // This method takes a param and sets the submittedLabelCount
        if (!param) {
            return this;
        }
        if (svl.ui && svl.ui.ribbonMenu) {
          if ('message' in param) {
              $submittedLabelMessage.html(message);
          } else if ('numCurbRampLabels' in param && 'numMissingCurbRampLabels' in param) {
              var message = "You've submitted <b>" +
                  param.numCurbRampLabels +
                  "</b> curb ramp labels and <br /><b>" +
                  param.numMissingCurbRampLabels +
                  "</b> missing curb ramp labels.";
              $submittedLabelMessage.html(message);
          }
        }
        return this;
    };

    _init(params);
    return self;
}

/** @namespace */
var svl = svl || {};

/**
 * The main module of SVLabel
 * @param $: jQuery object
 * @param param: other parameters
 * @returns {{moduleName: string}}
 * @constructor
 * @memberof svl
 */
function Main ($, params) {
    var self = {moduleName: 'Main'};
    var properties = {};
    var status = {};

    ////////////////////////////////////////
    // Private Functions
    ////////////////////////////////////////
    function _init (params) {
        var currentProgress;
        var panoId = params.panoId;
        var SVLat = parseFloat(params.initLat);
        var SVLng = parseFloat(params.initLng);
        currentProgress = parseFloat(currentProgress);

        svl.rootDirectory = ('rootDirectory' in params) ? params.rootDirectory : '/';

        // Instantiate objects
        svl.ui = new UI($);
        svl.labelContainer = new LabelContainer();
        svl.keyboard = new Keyboard($);
        svl.canvas = new Canvas($);
        svl.form = new Form($, params.form);
        svl.examples = undefined;
        svl.overlayMessageBox = new OverlayMessageBox($);
        svl.statusMessage = new StatusMessage($, params.missionDescription);
//        svl.labeledLandmarkFeedback = new LabeledLandmarkFeedback($);
        svl.labelCounter = new LabelCounter($, d3);
        svl.qualificationBadges = undefined;
        svl.progressFeedback = new ProgressFeedback($);
        svl.actionStack = new ActionStack($);
        svl.ribbon = new RibbonMenu($);
        svl.popUpMessage = new PopUpMessage($);
        svl.zoomControl = new ZoomControl($);
        svl.tooltip = undefined;
        svl.onboarding = undefined;
        svl.progressPov = new ProgressPov($);
        svl.pointCloud = new PointCloud($, {panoIds: [panoId]});
        svl.tracker = new Tracker();
        svl.labelFactory = new LabelFactory();
        svl.compass = new Compass($);


        svl.form.disableSubmit();
        svl.tracker.push('TaskStart');
      //
      // Set map parameters and instantiate it.
      var mapParam = {};
      mapParam.canvas = svl.canvas;
      mapParam.overlayMessageBox = svl.overlayMessageBox;


      var task = null;
      var nearbyPanoIds = [];
      var totalTaskCount = -1;
      var taskPanoramaId = '';
      var taskRemaining = -1;
      var taskCompleted = -1;
      var isFirstTask = false;

      totalTaskCount = 1; // taskSpecification.numAllTasks;
      taskRemaining = 1; // taskSpecification.numTasksRemaining;
      taskCompleted = totalTaskCount - taskRemaining;
      currentProgress = taskCompleted / totalTaskCount;

      svl.form.setTaskRemaining(taskRemaining);
      svl.form.setTaskDescription('TestTask');
      svl.form.setTaskPanoramaId(panoId);


      mapParam.Lat = SVLat;
      mapParam.Lng = SVLng;
      mapParam.panoramaPov = {
          heading: 0,
          pitch: -10,
          zoom: 1
      };
      mapParam.taskPanoId = panoId;
      nearbyPanoIds = [mapParam.taskPanoId];
      mapParam.availablePanoIds = nearbyPanoIds;

//      svl.statusMessage.setCurrentStatusDescription('Your mission is to ' +
//          '<span class="bold">find and label</span> presence and absence of curb ramps at intersections.');
      svl.statusMessage.restoreDefault();
      // svl.statusMessage.setCurrentStatusDescription("Your mission is to find and label all the accessibility attributes in the sidewalks and streets.");
      svl.progressFeedback.setProgress(currentProgress);
      svl.progressFeedback.setMessage("You have finished " + (totalTaskCount - taskRemaining) +
          " out of " + totalTaskCount + ".");

      if (isFirstTask) {
          svl.popUpMessage.setPosition(10, 120, width=400, height=undefined, background=true);
          svl.popUpMessage.setMessage("<span class='bold'>Remember, label all the landmarks close to the bus stop.</span> " +
              "Now the actual task begins. Click OK to start the task.");
          svl.popUpMessage.appendOKButton();
          svl.popUpMessage.show();
      } else {
          svl.popUpMessage.hide();
      }

      // Instantiation
      svl.map = new Map($, mapParam);
      svl.map.disableClickZoom();
      if ('task' in svl) {
        google.maps.event.addDomListener(window, 'load', svl.task.render);
      }

      //svl.map.setStatus('hideNonavailablePanoLinks', true);
    }

    _init(params);
    return self;
}

var svl = svl || {};
var panorama;
svl.panorama = panorama;

////////////////////////////////////////
// Street View Global functions that can
// be accessed from anywhere
////////////////////////////////////////
// Get the camera point-of-view (POV)
// http://www.geocodezip.com/v3_Streetview_lookAt.html?lat=34.016673&lng=-118.501322&zoom=18&type=k


//
// Helper functions
//
function getPanoId() {
    if (svl.panorama) {
        var panoId = svl.panorama.getPano();
        return panoId;
    } else {
        throw 'getPanoId() (in Map.js): panorama not defined.'
    }
}
svl.getPanoId = getPanoId;


function getPosition() {
    if (svl.panorama) {
        var pos = svl.panorama.getPosition();
        if (pos) {
            var ret = {
                'lat' : pos.lat(),
                'lng' : pos.lng()
            };
            return ret;
        }
    } else {
        throw 'getPosition() (in Map.js): panorama not defined.';
    }
}
svl.getPosition = getPosition;

function setPosition(lat, lng) {
    if (svl.panorama) {
        var pos = new google.maps.LatLng(lat, lng);
        svl.panorama.setPosition(pos);
    }
}
svl.setPosition = setPosition;

function getPOV() {
    if (svl.panorama) {
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
    } else {
        throw 'getPOV() (in Map.js): panoarama not defined.';
    }
}
svl.getPOV = getPOV;


function getLinks () {
    if (svl.panorama) {
        var links = svl.panorama.getLinks();
        return links;
    } else {
        throw 'getLinks() (in Map.js): panorama not defined.';
    }
}
svl.getLinks = getLinks;

//
// Fog related variables.
var fogMode = false;
var fogSet = false;
var current;
var first;
var previousPoints = [];
var radius = .1;
var isNotfirst = 0;
var paths;
svl.fog = undefined;;
var au = [];
var pty = [];
//au = adjustFog(fog, current.lat(), current.lng(), radius);
var polys = [];


/**
 * The Map module.
 * @param params {object} Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Map ($, params) {
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
            disableWalking : false,
            disableClickZoom: false,
            hideNonavailablePanoLinks : false,
            lockDisableWalking : false,
            panoLinkListenerSet: false,
            svLinkArrowsLoaded : false
        };

    var panoramaOptions;

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
    var fenway;
    var map;
    var mapOptions;
    var mapStyleOptions;
    var fogParam = {
        interval: undefined,
        ready: undefined
    };
    var svgListenerAdded = false;

    // Street View variables
    var _streetViewInit;

    // jQuery doms
    var $canvas;
    var $divLabelDrawingLayer;
    var $divPano;
    var $divStreetViewHolder;
    var $divViewControlLayer;
    var $spanModeSwitchWalk;
    var $spanModeSwitchDraw;


    ////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////
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
    fenway = new google.maps.LatLng(properties.latlng.lat, properties.latlng.lng);

    mapOptions = {
        center: fenway,
        mapTypeControl:false,
        mapTypeId: google.maps.MapTypeId.ROADMAP,
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
    map = new google.maps.Map(mapCanvas, mapOptions);
    properties.map = map;

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


    map.setOptions({styles: mapStyleOptions});

    function _init(params) {
        params = params || {};

        self.properties = properties; // Make properties public.
        properties.browser = svl.util.getBrowser();

        if ("overlayMessageBox" in params) {
            overlayMessageBox = params.overlayMessageBox;
        }


        // Set GSV panorama options
        // To not show StreetView controls, take a look at the following gpage
        // http://blog.mridey.com/2010/05/controls-in-maps-javascript-api-v3.html
        //
        // This is awesome... There is a hidden option called 'mode' in the SV panoramaOption.
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

            // throw self.className + ' init(): Specifying a dropping point with a latlng coordinate is no longer a good idea. It does not drop the pegman on the specified position.';
        } else {
            throw self.className + ' init(): The pano id nor panorama position is give. Cannot initialize the panorama.';
        }

        var panoCanvas = document.getElementById('pano');
        svl.panorama = new google.maps.StreetViewPanorama(panoCanvas, panoramaOptions);
        svl.panorama.set('addressControl', false);
        svl.panorama.set('clickToGo', false);
        svl.panorama.set('disableDefaultUI', true);
        svl.panorama.set('linksControl', true);
        svl.panorama.set('navigationControl', false);
        svl.panorama.set('panControl', false);
        svl.panorama.set('zoomControl', false);
        svl.panorama.set('keyboardShortcuts', true);

        properties.initialPanoId = params.taskPanoId;
        $canvas = svl.ui.map.canvas;
        $divLabelDrawingLayer = svl.ui.map.drawingLayer;
        $divPano = svl.ui.map.pano;
        $divStreetViewHolder = svl.ui.map.streetViewHolder;
        $divViewControlLayer = svl.ui.map.viewControlLayer;
        $spanModeSwitchWalk = svl.ui.map.modeSwitchWalk;
        $spanModeSwitchDraw = svl.ui.map.modeSwitchDraw;

        // Set so the links to panoaramas that are not listed on availablePanoIds will be removed
        status.availablePanoIds = params.availablePanoIds;

        // Attach listeners to dom elements
        $divViewControlLayer.bind('mousedown', viewControlLayerMouseDown);
        $divViewControlLayer.bind('mouseup', viewControlLayerMouseUp);
        $divViewControlLayer.bind('mousemove', viewControlLayerMouseMove);
        $divViewControlLayer.bind('mouseleave', viewControlLayerMouseLeave);


        // Add listeners to the SV panorama
        // https://developers.google.com/maps/documentation/javascript/streetview#StreetViewEvents
        google.maps.event.addListener(svl.panorama, "pov_changed", handlerPovChange);
//        google.maps.event.addListener(svl.panorama, "position_changed", handlerPovChange);
        google.maps.event.addListener(svl.panorama, "position_changed", handlerPositionUpdate);
        google.maps.event.addListener(svl.panorama, "pano_changed", handlerPanoramaChange);

        // Connect the map view and panorama view
        map.setStreetView(svl.panorama);

        // Set it to walking mode initially.
        google.maps.event.addListenerOnce(svl.panorama, "pano_changed", self.modeSwitchWalkClick);

        _streetViewInit = setInterval(initStreetView, 100);

        //if ("disableWalking" in params && params.disableWalking) {
        //    disableWalking();
        //} else {
        //    enableWalking();
        //}
        //
        // Set the fog parameters
        // Comment out to disable the fog feature.
        if ("onboarding" in svl &&
            svl.onboarding &&
            svl.onboarding.className === "Onboarding_LabelingCurbRampsDifficultScene") { //"zoomViewAngles" in params) {
            fogParam.zoomViewAngles = [Math.PI / 2, Math.PI / 4, Math.PI / 8];
        }
        fogParam.interval = setInterval(initFog, 250);

        // Hide the dude on the top-left of the map.
        mapIconInterval = setInterval(removeIcon, 0.2);

        //
        // For Internet Explore, append an extra canvas in viewControlLayer.
        properties.isInternetExplore = $.browser['msie'];
        if (properties.isInternetExplore) {
            $divViewControlLayer.append('<canvas width="720px" height="480px"  class="Window_StreetView" style=""></canvas>');
        }
    }

    /**
     *
     */
    function removeIcon() {
        var doms = $('.gmnoprint');
        if (doms.length > 0) {
            window.clearInterval(mapIconInterval);
            $.each($('.gmnoprint'), function (i, v) {
                var $images = $(v).find('img');
                if ($images) {
                    $images.css('visibility', 'hidden');
                }
            });
        }
    }

    /**
     * This method disables zooming by double click.
     */
    function disableClickZoom () {
        status.disableClickZoom = true;
    }

    /**
     * This method disables walking by hiding links towards other Street View panoramas.
     * @returns {disableWalking}
     */
    function disableWalking () {

        // This method hides links on SV and disables users from walking.
        if (!status.lockDisableWalking) {
            // Disable clicking links and changing POV
            hideLinks();
            $spanModeSwitchWalk.css('opacity', 0.5);
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
     * This method enables walking to other panoramas by showing links.
     */
    function enableWalking () {
        // This method shows links on SV and enables users to walk.
        if (!status.lockDisableWalking) {
            // Enable clicking links and changing POV
            showLinks();
            $spanModeSwitchWalk.css('opacity', 1);
            status.disableWalking = false;
        }
    }

    function fogUpdate () {
        var pov = svl.getPOV();

        if (pov) {
            var heading = pov.heading;
            var dir = heading * (Math.PI / 180);
            svl.fog.updateFromPOV(current, radius, dir, Math.PI/2);
        }
    }


    function getMap() { return properties.map; }
    function getInitialPanoId () { return properties.initialPanoId; }
    function getMaxPitch () { return properties.maxPitch; }
    function getMinPitch () { return properties.minPitch; }

    /**
     * This method returns a value of a specified property.
     * @param prop
     * @returns {*}
     */
    function getProperty (prop) { return (prop in properties) ? properties[prop] : false; }

    /**
     * Returns a panorama dom element that is dynamically created by GSV API
     * @returns {*}
     */
    function getPanoramaLayer () { return $divPano.children(':first').children(':first').children(':first').children(':eq(5)'); }

    /**
     * Get svg element (arrows) in Street View.
     * @returns {*}
     */
    function getLinkLayer () { return $divPano.find('svg').parent(); }

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
     * Save
     */
    function save () {
        svl.storage.set("map", {"pov": svl.getPOV(), "latlng": svl.getPosition(), "panoId": svl.getPanoId() });
    }

    /**
     * Load
     */
    function load () { return svl.storage.get("map"); }

    /**
     * This method brings the links (<, >) to the view control layer so that a user can click them to walk around
     */
    function makeLinksClickable () {
        // Bring the layer with arrows forward.
        var $links = getLinkLayer();
        $divViewControlLayer.append($links);

        if (properties.browser === 'mozilla') {
            // A bug in Firefox? The canvas in the div element with the largest z-index.
            $divViewControlLayer.append($canvas);
        } else if (properties.browser === 'msie') {
            $divViewControlLayer.insertBefore($divLabelDrawingLayer);
        }
    }

    /**
     * Initializes fog.
     */
    function initFog () {
        // Initialize the fog on top of the map.
        if (current) {
            fogParam.center = current;
            fogParam.radius = 200;

            current = svl.panorama.getPosition();
            svl.fog = new Fog(map, fogParam);
            fogSet = true;
            window.clearInterval(fogParam.interval);
            fogUpdate();
        }
    }

    /**
     * Initailize Street View
     */
    function initStreetView () {
        // Initialize the Street View interface
        var numPath = $divViewControlLayer.find("path").length;
        if (numPath !== 0) {
            status.svLinkArrowsLoaded = true;
            window.clearTimeout(_streetViewInit);
        }
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
                svl.canvas.setVisibilityBasedOnLocation('visible', svl.getPanoId());
                if (properties.mode === 'Evaluation') {
                    myTables.updateCanvas();
                }
                svl.canvas.render2();
            }

//            if ('storage' in svl) {
//                svl.storage.set('currentPanorama', svl.panorama.getPano());
//                svl.storage.set('currentPov', svl.panorama.getPov());
//            }

            if (fogSet) {
                fogUpdate();
            }

            // Attach listeners to svl.pointCloud
            if ('pointCloud' in svl && svl.pointCloud) {
                var panoId = svl.getPanoId();
                var pointCloud = svl.pointCloud.getPointCloud(panoId);
                if (!pointCloud) {
                    svl.pointCloud.createPointCloud(svl.getPanoId());
                    // svl.pointCloud.ready(panoId, function () {
                        // console.log(svl.pointCloud.getPointCloud(panoId));
                    //});
                }
            }
        } else {
            throw self.className + ' handlerPanoramaChange(): panorama not defined.';
        }

        if ('compass' in svl) {
            svl.compass.update();
        }
    }

    /**
     * A callback for position_change.
     */
    function handlerPositionUpdate () {
        var position = svl.panorama.getPosition();
        handlerPovChange(); // handle pov change

        // Store the current status
//        if ('storage' in svl) {
//            svl.tracker.save();
//            svl.labelContainer.save();
//            svl.map.save();
//            svl.task.save();
//        }

        // End of the task if the user is close enough to the end point
        if ('task' in svl) {
            if (svl.task.isAtEnd(position.lat(), position.lng(), 10)) {
                svl.task.endTask();
            }
        }

        if ('compass' in svl) {
            svl.compass.update();
        }
    }

    /**
     * Callback for pov update
     */
    function handlerPovChange () {
        // This is a callback function that is fired when pov is changed
        if (svl.canvas) {
            var latlng = getPosition();
            var heading = svl.getPOV().heading;

            svl.canvas.clear();

            if (status.currentPanoId !== svl.getPanoId()) {
            	svl.canvas.setVisibilityBasedOnLocation('visible', svl.getPanoId());
            }
            status.currentPanoId = svl.getPanoId();


            if (properties.mode === 'Evaluation') {
                myTables.updateCanvas();
            }
            svl.canvas.render2();
        }

        // Sean & Vicki Fog code
        if (fogMode && "fog" in svl) {
            current = svl.panorama.getPosition();
            if (current) {
                if (!fogSet) {

                } else {
                    fogUpdate();
                    // var dir = heading * (Math.PI / 180);
                    // fog.updateFromPOV(current, radius, dir, Math.PI/2);
                }
           }
         }

        // Add event listener to svg. Disable walking to far.
        if ($('svg')[0]) {
            if (!svgListenerAdded) {
                svgListenerAdded = true;
                $('svg')[0].addEventListener('mousedown', function (e) {
                    showLinks();
                });
            }
        }

        if ('compass' in svl) {
            svl.compass.update();
        }
    }

    /**
     * This method locks status.disableWalking
     * @returns {lockDisableWalking}
     */
    function lockDisableWalking () {
        status.lockDisableWalking = true;
        return this;
    }

    function lockRenderLabels () {
        lock.renderLabels = true;
        return this;
    }

    /**
     * This function brings a div element for drawing labels in front of
     */
    function modeSwitchWalkClick () {
        $divViewControlLayer.css('z-index', '1');
        $divLabelDrawingLayer.css('z-index','0');
        if (!status.disableWalking) {
            // Show the link arrows on top of the panorama
            showLinks();
            // Make links clickable
            makeLinksClickable();
        }
    }

    /**
     *
     */
    function modeSwitchLabelClick () {
        $divLabelDrawingLayer.css('z-index','1');
        $divViewControlLayer.css('z-index', '0');
        // $divStreetViewHolder.append($divLabelDrawingLayer);

        if (properties.browser === 'mozilla') {
            // A bug in Firefox? The canvas in the div element with the largest z-index.
            $divLabelDrawingLayer.append($canvas);
        }

        hideLinks();
    }

    /**
     * Plot markers on the Google Maps pane
     *
     * Example: https://google-developers.appspot.com/maps/documentation/javascript/examples/icon-complex?hl=fr-FR
     * @returns {boolean}
     */
    function plotMarkers () {
        if (canvas) {
            var prop, labelType, latlng,
                labels = canvas.getLabels(),
                labelsLen = labels.length;

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
     *
     * @param type
     */
    function setViewControlLayerCursor(type) {
        switch(type) {
            case 'ZoomOut':
                $divViewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/Cursor_ZoomOut.png) 4 4, move");
                break;
            case 'OpenHand':
                $divViewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/openhand.cur) 4 4, move");
                break;
            case 'ClosedHand':
                $divViewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/closedhand.cur) 4 4, move");
                break;
            default:
                $divViewControlLayer.css("cursor", "default");
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
            var numPath = $divViewControlLayer.find("path").length;
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
     * This is a callback function that is fired with the mouse down event
     * on the view control layer (where you control street view angle.)
     * @param e
     */
    function viewControlLayerMouseDown (e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = mouseposition(e, this).x;
        mouseStatus.leftDownY = mouseposition(e, this).y;

        if (!status.disableWalking) {
            // Setting a cursor
            // http://www.jaycodesign.co.nz/css/cross-browser-css-grab-cursors-for-dragging/
            try {
                if (!svl.keyboard.isShiftDown()) {
                    setViewControlLayerCursor('ClosedHand');
                    // $divViewControlLayer.css("cursor", "url(public/img/cursors/openhand.cur) 4 4, move");
                } else {
                    setViewControlLayerCursor('ZoomOut');
                }
            } catch (e) {
                console.error(e);
            }
        }

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

        svl.tracker.push('ViewControl_MouseDown', {x: mouseStatus.leftDownX, y:mouseStatus.leftDownY});
    }

    /**
     * This is a callback function that is called with mouse up event on
     * the view control layer (where you change the Google Street view angle.
     * @param e
     */
    function viewControlLayerMouseUp (e) {
        var currTime;

        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = mouseposition(e, this).x;
        mouseStatus.leftUpY = mouseposition(e, this).y;
        svl.tracker.push('ViewControl_MouseUp', {x:mouseStatus.leftUpX, y:mouseStatus.leftUpY});

        if (!status.disableWalking) {
            // Setting a mouse cursor
            // http://www.jaycodesign.co.nz/css/cross-browser-css-grab-cursors-for-dragging/
            try {
                if (!svl.keyboard.isShiftDown()) {
                    setViewControlLayerCursor('OpenHand');
                    // $divViewControlLayer.css("cursor", "url(public/img/cursors/openhand.cur) 4 4, move");
                } else {
                    setViewControlLayerCursor('ZoomOut');
                }
            } catch (e) {
                console.error(e);
            }
        }

        currTime = new Date().getTime();

        if (currTime - mouseStatus.prevMouseUpTime < 300) {
            // Double click
            // canvas.doubleClickOnCanvas(mouseStatus.leftUpX, mouseStatus.leftDownY);
            if (!status.disableClickZoom) {
                svl.tracker.push('ViewControl_DoubleClick');
                if (svl.keyboard.isShiftDown()) {
                    // If Shift is down, then zoom out with double click.
                    svl.zoomControl.zoomOut();
                    svl.tracker.push('ViewControl_ZoomOut');
                } else {
                    // If Shift is up, then zoom in wiht double click.
                    // svl.zoomControl.zoomIn();
                    svl.zoomControl.pointZoomIn(mouseStatus.leftUpX, mouseStatus.leftUpY);
                    svl.tracker.push('ViewControl_ZoomIn');
                }
            }

        }
        mouseStatus.prevMouseUpTime = currTime;
    }

    /**
     * This is a callback function that is fired when a user moves a mouse on the
     * view control layer where you change the pov.
     */
    function viewControlLayerMouseMove (e) {
        mouseStatus.currX = mouseposition(e, this).x;
        mouseStatus.currY = mouseposition(e, this).y;

        //
        // Show a link and fade it out
        if (!status.disableWalking) {
            showLinks(2000);
            if (!mouseStatus.isLeftDown) {
                try {
                    if (!svl.keyboard.isShiftDown()) {
                        setViewControlLayerCursor('OpenHand');
                        // $divViewControlLayer.css("cursor", "url(public/img/cursors/openhand.cur) 4 4, move");
                    } else {
                        setViewControlLayerCursor('ZoomOut');
                    }
            } catch (e) {
                    console.error(e);
                }
            } else {

            }
        } else {
            setViewControlLayerCursor('default');
            // $divViewControlLayer.css("cursor", "default");
        }

        if (mouseStatus.isLeftDown &&
            status.disableWalking === false) {
            //
            // If a mouse is being dragged on the control layer, move the sv image.
            var dx = mouseStatus.currX - mouseStatus.prevX;
            var dy = mouseStatus.currY - mouseStatus.prevY;
            var pov = svl.getPOV();
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
     *
     * @param e
     */
    function viewControlLayerMouseLeave (e) {
        mouseStatus.isLeftDown = false;
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

    function setMode (modeIn) { properties.mode = modeIn; return this; }

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

    function setPov (pov, duration, callback) {
        // Change the pov.
        // If a transition duration is set, smoothly change the pov over the time specified (milli-sec)
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

            if (duration) {
                var timeSegment = 25; // 25 milli-sec

                // Get how much angle you change over timeSegment of time.
                var cw = (pov.heading - currentPov.heading + 360) % 360;
                var ccw = 360 - cw;
                var headingDelta;
                var headingIncrement;
                if (cw < ccw) {
                    headingIncrement = cw * (timeSegment / duration);
                } else {
                    headingIncrement = (-ccw) * (timeSegment / duration);
                }

                var pitchIncrement;
                var pitchDelta = pov.pitch - currentPov.pitch;
                pitchIncrement = pitchDelta * (timeSegment / duration);


                interval = window.setInterval(function () {
                    var headingDelta = pov.heading - currentPov.heading;
                    if (Math.abs(headingDelta) > 1) {
                        //
                        // Update heading angle and pitch angle
                        /*
                         var angle = (360 - pov.heading) + currentPov.heading;
                         if (angle < 180 || angle > 360) {
                         currentPov.heading -= headingIncrement;
                         } else {
                         currentPov.heading += headingIncrement;
                         }
                         */
                        currentPov.heading += headingIncrement;
                        currentPov.pitch += pitchIncrement;
                        currentPov.heading = (currentPov.heading + 360) % 360; //Math.ceil(currentPov.heading);
                        currentPov.pitch = currentPov.pitch; // Math.ceil(currentPov.pitch);
                        svl.panorama.setPov(currentPov);
                    } else {
                        //
                        // Set the pov to adjust the zoom level. Then clear the interval.
                        // Invoke a callback function if there is one.
                        if (!pov.zoom) {
                            pov.zoom = 1;
                        }
                        //pov.heading = Math.ceil(pov.heading);
                        //pov.pitch = Math.ceil(pov.pitch);
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

    function showDeleteLabelMenu () {
        var item = canvas.isOn(mouseStatus.currX,  mouseStatus.currY);
        if (item && item.className === "Point") {
            var selectedLabel = item.belongsTo().belongsTo();
            if (selectedLabel === canvas.getCurrentLabel()) {
                canvas.showDeleteLabel(mouseStatus.currX, mouseStatus.currY);
            }
        }
    }


    function unlockDisableWalking () { status.lockDisableWalking = false; return this; }
    function unlockRenderLabels () { lock.renderLabels = false; return this; }


    self.disableWalking = disableWalking;
    self.disableClickZoom = disableClickZoom;
    self.enableClickZoom = enableClickZoom;
    self.enableWalking = enableWalking;
    self.getInitialPanoId = getInitialPanoId;
    self.getMap = getMap;
    self.getMaxPitch = getMaxPitch;
    self.getMinPitch = getMinPitch;
    self.getProperty = getProperty;
    self.hideLinks = hideLinks;
    self.load = load;
    self.lockDisableWalking = lockDisableWalking;
    self.lockRenderLabels = lockRenderLabels;
    self.modeSwitchLabelClick = modeSwitchLabelClick;
    self.modeSwitchWalkClick = modeSwitchWalkClick;
    self.plotMarkers = plotMarkers;
    self.save = save;
    self.setHeadingRange = setHeadingRange;
    self.setMode = setMode;
    self.setPitchRange = setPitchRange;
    self.setPov = setPov;
    self.setStatus = setStatus;
    self.unlockDisableWalking = unlockDisableWalking;
    self.unlockRenderLabels = unlockRenderLabels;

    _init(params);
    return self;
}

var svl = svl || {};

/**
 * A Modal module
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalSkip ($) {
    var self = { className : 'Modal'},
        status = {
            disableClickOK: true
        };



    function _init () {
        disableClickOK();

        svl.ui.modalSkip.ok.bind("click", handlerClickOK);
        svl.ui.modalSkip.cancel.bind("click", handlerClickCancel);
        svl.ui.modalSkip.radioButtons.bind("click", handlerClickRadio);
    }

    /**
     * This method handles a click OK event
     * @param e
     */
    function handlerClickOK (e) {
        var radioValue = $('input[name="modal-skip-radio"]:checked', '#modal-skip-content').val(),
            position = svl.panorama.getPosition(),
            incomplete = {
                issue_description: radioValue,
                lat: position.lat(),
                lng: position.lng()
            };

        svl.form.skipSubmit(incomplete);
        hideSkipMenu();
    }

    /**
     * This method handles a click Cancel event
     * @param e
     */
    function handlerClickCancel (e) {
        hideSkipMenu();
    }

    /**
     * This method takes care of nothing.
     * @param e
     */
    function handlerClickRadio (e) {
        enableClickOK();
    }

    /**
     * Hide the background of the modal menu
     */
    function hidePageOverlay () {
        svl.ui.modal.overlay.css('visibility', 'hidden');
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
    }


    function disableClickOK () {
        svl.ui.modalSkip.ok.attr("disabled", true);
        svl.ui.modalSkip.ok.addClass("disabled");
        status.disableClickOK = true;
    }

    function enableClickOK () {
        svl.ui.modalSkip.ok.attr("disabled", false);
        svl.ui.modalSkip.ok.removeClass("disabled");
        status.disableClickOK = false;
    }


    _init();

    self.showSkipMenu = showSkipMenu;
    self.hideSkipMenu = hideSkipMenu;
    return self;
}

var svl = svl || {};

/**
 * A Mouse module
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Mouse ($) {
    var self = { className : 'Mouse' };

    function _init () {
        $(document).bind('mouseup', mouseUp);
    }

    function mouseUp (e) {
        // A call back method for mouseup. Capture a right click and do something.
        // Capturing right click in javascript.
        // http://stackoverflow.com/questions/2405771/is-right-click-a-javascript-event
        var isRightMB;
        e = e || window.event;

        if ("which" in e)  // Gecko (Firefox), WebKit (Safari/Chrome) & Opera
            isRightMB = e.which == 3;
        else if ("button" in e)  // IE, Opera
            isRightMB = e.button == 2;

        if (isRightMB) {

        }
    }


    _init();
    return self;
}

var svl = svl || {};

/**
 *
 * @param $ {object} jQuery object
 * @param params {object} other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function OverlayMessageBox ($, params) {
    var self = {
            'className' : 'OverlayMessageBox'
        };
    var properties = {
            'visibility' : 'visible'
        };
    var status = {};

    var $divOverlayMessage;
    var $divOverlayMessageBox;

    ////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////
    function init() {
        // Initialization function.
        if (svl.ui && svl.ui.overlayMessage) {
          $divOverlayMessage = svl.ui.overlayMessage.message;
          $divOverlayMessageBox = svl.ui.overlayMessage.box;

          self.setMessage('Walk');
        }

    }

    ////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////
    self.setMessage = function (mode, message) {
        var instructions = svl.misc.getLabelInstructions(),
            labelColors = svl.misc.getLabelColors();

        if ((mode in instructions) &&
            (mode in labelColors)) {
            // Set the box color.
            var modeColor = labelColors[mode];
            var backgroundColor = changeAlphaRGBA(modeColor.fillStyle, 0.85);
            backgroundColor = changeDarknessRGBA(backgroundColor, 0.35);
            $divOverlayMessageBox.css({
                'background' : backgroundColor
            });
            $divOverlayMessage.css({
                'color' : instructions[mode].textColor
            });

            // Set the instructional message.
            if (message) {
                // Manually set a message.
                $divOverlayMessage.html(message);
            } else {
                // Otherwise use the pre set message
                $divOverlayMessage.html('<strong>' + instructions[mode].instructionalText + '</strong>');
            }
            return this;
        } else {
            return false;
        }
    };

    self.setVisibility = function (val) {
        // Set the visibility to visible or hidden.
        if (val === 'visible' || val === 'hidden') {
            properties.visibility = val;
        }
        return this;
    };

    ////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////
    init();

    return self;
}

var svl = svl || {};

/**
 *
 * @param points
 * @param params
 * @returns {{className: string, points: undefined}}
 * @constructor
 * @memberof svl
 */
function Path (points, params) {
    // Path object constructor
    // This class object holds an array of Point objects.
    //
    // For canvas properties, take a look at:
    // https://developer.mozilla.org/en-US/docs/HTML/Canvas/Tutorial/Applying_styles_and_colors
    //
    var self = { className : 'Path', points : undefined };
    var belongsTo;
    var properties = {
        fillStyle: 'rgba(255,255,255,0.5)',
        lineCap : 'round', // ['butt','round','square']
        lineJoin : 'round', // ['round','bevel','miter']
        lineWidth : '3',
        numPoints: points.length,
        originalFillStyle: undefined,
        originalStrokeStyle: undefined,
        strokeStyle : 'rgba(255,255,255,1)',
        strokeStyle_bg : 'rgba(255,255,255,1)' //potentially delete
    };
    var status = {
        visibility: 'visible'
    };

//    function assemble () {
//        var p = [];
//        for (var i = 0; i < self.points.length; i++) {
//            p.push(self.points[i].assemble());
//        }
//        return {
//            properties: properties,
//            status: status,
//            points: p
//        }
//    }
//    self.assemble = assemble;

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

        properties.fillStyle = changeAlphaRGBA(points[0].getProperty('fillStyleInnerCircle'), 0.5);
        properties.originalFillStyle = properties.fillStyle;
        properties.originalStrokeStyle = properties.strokeStyle;
    }

    /**
     * Returns the line width
     * @returns {string}
     */
    function getLineWidth () {
      return properties.lineWidth;
    }

    /**
     * Returns fill color of the path
     * @returns {string}
     */
    function getFill() {
      return properties.fillStyle;
    }

    /**
     * Sets fill color of the path
     * @param fill
     */
    function setFill(fill) {
      properties.fillStyle = fill;
    }

    /**
     * This function checks if a mouse cursor is on any of a points and return
     * @param povIn
     * @returns {{x: number, y: number, width: number, height: number}}
     */
    function getBoundingBox(povIn) {
        var pov = povIn ? povIn : svl.getPOV();
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

      //
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
     * Get canvas coordinate
     * @param pov
     * @returns {Array}
     */
    function getCanvasCoordinates (pov) {
        // Get canvas coordinates of points that constitute the path.
        var imCoords = getImageCoordinates();
        var i;
        var len = imCoords.length;
        var canvasCoord;
        var canvasCoords = [];
        var min = 10000000;
        var max = -1;

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
     * Returns points
     * @returns {*}
     */
    function getPoints() {
        return points;
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

    ////////////////////////////////////////
    // self functions
    ////////////////////////////////////////
    self.belongsTo = function () {
        // This function returns which object (i.e. Label) this Path
        // belongs to.
        if (belongsTo) {
            return belongsTo;
        } else {
            return false;
        }
    };

    self.getPOV = function() {
        return points[0].getPOV();
    };

    self.getBoundingBox = function (pov) {
        // Get a bounding box of this path
        return getBoundingBox(pov);
    };

    self.getLineWidth = function () {
      // get line width
      return getLineWidth();
    };

    self.getFill = function () {
      return getFill();
    };

    self.getFillStyle = function () {
        // Get the fill style.
        return properties.fillStyle;
    };


    self.getSvImageBoundingBox = function () {
        // Get a boudning box
        return getSvImageBoundingBox();
    };


    self.getImageCoordinates = function () {
        // Get the image coordinates of the path.
        return getImageCoordinates();
    };


    /**
     * This function returns points.
     */
    self.getPoints = function (reference) {
        //
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
    };

    self.getProperty = function (key) {
        return properties[key];
    };


    self.isOn = function (x, y) {
        // This function checks if a mouse cursor is on any of a points and return
        // a point if the cursor is indeed on the point.
        // Otherwise, this function checks if the mouse cursor is on a bounding box
        // of this path. If the cursor is on the bounding box, then this function
        // returns this path object.
        var boundingBox;
        var i;
        var j;
        var point;
        var pointsLen;
        var result;

        //
        // Check if the passed point (x, y) is on any of points.
        pointsLen = self.points.length;
        for (j = 0; j < pointsLen; j += 1) {
            point = self.points[j];
            result = point.isOn(x, y);
            if (result) {
                return result;
            }
        }

        //
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
    };

    /**
     * This method calculates the area overlap between bouding boxes of this path and
     * another path passed as an argument.
     * @param path
     * @param mode
     * @returns {number}
     */
    self.overlap = function (path, mode) {
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
    };

    /**
     * This method remove all the points in the list points.
     */
    self.removePoints = function () {
        self.points = undefined;
    };

    self.render2 = function (ctx, pov) {
        return self.render(pov, ctx);
    };

    /**
     * This method renders a path.
     * @param pov
     * @param ctx
     */
    self.render = function (pov, ctx) {
        if (status.visibility === 'visible') {
            var pathLen;
            var point;
            var j;

            pathLen = self.points.length;

            // Get canvas coordinates to render a path.
            var canvasCoords = getCanvasCoordinates(pov);

            // Set the fill color
            point = self.points[0];
            ctx.save();
            ctx.beginPath();
            if (!properties.fillStyle) {
                properties.fillStyle = changeAlphaRGBA(point.getProperty('fillStyleInnerCircle'), 0.5);
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
                        var currCoord = canvasCoords[j];
                        var prevCoord = canvasCoords[j - 1];
                    } else {
                        var currCoord = canvasCoords[j];
                        var prevCoord = canvasCoords[pathLen - 1];
                    }
                    var r = point.getProperty('radiusInnerCircle');
                    ctx.save();
                    ctx.strokeStyle = properties.strokeStyle;
                    svl.util.shape.lineWithRoundHead(ctx, prevCoord.x, prevCoord.y, r, currCoord.x, currCoord.y, r);
                    ctx.restore();
                }
            }
        }
    };

    self.renderBoundingBox = renderBoundingBox;

    /**
     * This method changes the value of fillStyle to its original fillStyle value
     * @returns {self}
     */
    self.resetFillStyle = function () {
        properties.fillStyle = properties.originalFillStyle;
        return this;
    };

    /**
     * This method resets the strokeStyle to its original value
     * @returns {self}
     */
    self.resetStrokeStyle = function () {
        properties.strokeStyle = properties.originalStrokeStyle;
        return this;
    };

    self.setFill = function(fill) {
        // console.log(fill[1]);
        // console.log(fill.substring(4, fill.length-1));
        if(fill.substring(0,4)=='rgba'){
            setFill(fill);
        }
        else{
            setFill('rgba'+fill.substring(3,fill.length-1)+',0.5)');
        }
        return this;
    };

    self.setBelongsTo = function (obj) {
        belongsTo = obj;
        return this;
    };

    self.setLineWidth = function (lineWidth) {
        if(!isNaN(lineWidth)){
            properties.lineWidth  = ''+lineWidth;
        }
        return this;
    };

    self.setFillStyle = function (fill) {
        // This method sets the fillStyle of the path
        if(fill!=undefined){
            properties.fillStyle = fill;
        };
        return this;
    };

    self.setStrokeStyle = function (stroke) {
        // This method sets the strokeStyle of the path
        properties.strokeStyle = stroke;
        return this;
    };

    self.setVisibility = function (visibility) {
        // This method sets the visibility of a path (and points that cons
        if (visibility === 'visible' || visibility === 'hidden') {
            status.visibility = visibility;
        }
        return this;
    };

    // Initialize
    _init(points, params);

    return self;
}

var svl = svl || {};

/**
 * Point object
 *
 * @param x x-coordinate of the point on a canvas
 * @param y y-coordinate of the point on a canvas
 * @param pov Point of view that looks like {heading: h, pitch: p, zoom: z}
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

        //
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
                ctx.drawImage(imageObj, imageX, imageY, imageHeight, imageWidth);
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

    /**
     * this method sets the photographerHeading and photographerPitch
     * @param heading
     * @param pitch
     * @returns {self}
     */
    self.setPhotographerPov = function (heading, pitch) {
        properties.photographerHeading = heading;
        properties.photographerPitch = pitch;
        return this;
    };

    /**
     * This function resets all the properties specified in params.
     * @param params
     * @returns {self}
     */
    self.setProperties = function (params) {
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
    };

    self.setStrokeStyle = function (val) {
        // This method sets the strokeStyle of an outer circle to val
        properties.strokeStyleOuterCircle = val;
        return this;
    };

    self.setVisibility = function (visibility) {
        // This method sets the visibility of a path (and points that cons
        if (visibility === 'visible' || visibility === 'hidden') {
            status.visibility = visibility;
        }
        return this;
    };

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

var svl = svl || {};

/**
 *
 * @param $
 * @constructor
 */
function PointCloud ($, params) {
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
var svl = svl || {};

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
        buttons = [],
        OKButton = '<button id="pop-up-message-ok-button">OK</button>';

    function appendHTML (htmlDom, callback) {
        var $html = $(htmlDom);
        svl.ui.popUpMessage.box.append($html);

        if (callback) {
            $html.on("click", callback);
        }
        $html.on('click', hide);
        buttons.push($html);
    }

    function appendButton (buttonDom, callback) {
        var $button = $(buttonDom);

        $button.css({
            margin: '10 10 10 0'
        });
        $button.addClass('button');

//        svl.ui.popUpMessage.box.css('padding-bottom', '50px');
        svl.ui.popUpMessage.box.append($button);

        if (callback) {
            $button.on('click', callback);
        }
        $button.on('click', hide);
        buttons.push($button);
    }

    function appendOKButton(callback) {
        appendButton(OKButton, callback);
    }

    function handleClickOK () {
        $("#pop-up-message-ok-button").on('click', function () {
            if ('tracker' in svl && svl.tracker) {
                if (message) {
                    svl.tracker.push('MessageBox_ClickOk', {message: message});
                } else {
                    svl.tracker.push('MessageBox_ClickOk');
                }
            }
            $("#pop-up-message-ok-button").remove();
        });
    }

    /**
     * Hides the message box.
     */
    function hide () {
        // This method hides the message box.
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
     * Reset all the parameters.
     */
    function reset () {
        svl.ui.popUpMessage.holder.css({ width: '', height: '' });
        svl.ui.popUpMessage.box.css({
                    left: '',
                    top: '',
                    width: '',
                    height: '',
                    zIndex: ''
                });

        svl.ui.popUpMessage.box.css('padding-bottom', '')

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
        svl.ui.popUpMessage.box.css({
            left: x,
            top: y,
            width: width,
            height: height,
            zIndex: 1000
        });
        return this;
    }

    self.appendButton = appendButton;
    self.appendHTML = appendHTML;
    self.appendOKButton = appendOKButton;
    self.hide = hide;
    self.hideBackground = hideBackground;
    self.reset = reset;
    self.show = show;
    self.showBackground = showBackground;
    self.setPosition = setPosition;
    self.setTitle = setTitle;
    self.setMessage = setMessage;
    return self;
}

var svl = svl || {};

/**
 *
 * @param $
 * @param params
 * @returns {{className: string}}
 * @constructor
 */
function ProgressFeedback ($, params) {
    var self = {
        className : 'ProgressFeedback'
    };
    var properties = {
        progressBarWidth : undefined
    };
    var status = {
        progress : undefined
    };

    // jQuery elements
    var $progressBarContainer;
    var $progressBarFilled;
    var $progressMessage;

    ////////////////////////////////////////////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////////////////////////////////////////////
    function init (params) {
        $progressBarContainer = $("#ProgressBarContainer");
        $progressBarFilled = $("#ProgressBarFilled");
        $progressMessage = $("#Progress_Message");

        properties.progressBarWidth = $progressBarContainer.width();

        if (params && params.message) {
            self.setMessage(params.message);
        } else {
            self.setMessage('');
        }

        self.setProgress(0);
    }


    ////////////////////////////////////////////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////////////////////////////////////////////
    self.setMessage = function (message) {
        // This function sets a message box in the feedback area.
        $progressMessage.html(message);
    };


    self.setProgress = function (progress) {
        // Check if the passed argument is a number. If not, try parsing it as a
        // float value. If it fails (if parseFloat returns NaN), then throw an error.
        if (typeof progress !== "number") {
            progress = parseFloat(progress);
        }

        if (progress === NaN) {
            throw new TypeError(self.className + ': The passed value cannot be parsed.');
        }

        if (progress > 1) {
            progress = 1.0;
            console.error(self.className + ': You can not pass a value larger than 1 to setProgress.');
        }

        status.progress = progress;

        if (properties.progressBarWidth) {
            var r;
            var g;
            var color;

            if (progress < 0.5) {
                r = 255;
                g = parseInt(255 * progress * 2);
            } else {
                r = parseInt(255 * (1 - progress) * 2);
                g = 255;
            }

            color = 'rgba(' + r + ',' + g + ',0,1)';
            $progressBarFilled.css({
                background: color,
                width: progress * properties.progressBarWidth
            });
        }

        return this;
    };

    init(params);
    return self;
}

var svl = svl || {};

/**
 *
 * @param $
 * @param param
 * @returns {{className: string}}
 * @constructor
 */
function ProgressPov ($, param) {
    var oPublic = {className: 'ProgressPov'};
    var status = {
        currentCompletionRate: 0,
        previousHeading: 0,
        surveyedAngles: undefined
    };
    var properties = {};

    var $divCurrentCompletionRate;
    var $divCurrentCompletionBar;
    var $divCurrentCompletionBarFiller;

    ////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////
    function _init(param) {
        $divCurrentCompletionRate = svl.ui.progressPov.rate;
        $divCurrentCompletionBar = svl.ui.progressPov.bar;
        $divCurrentCompletionBarFiller = svl.ui.progressPov.filler;

        //
        // Fill in the surveyed angles
        status.surveyedAngles = new Array(100);
        for (var i=0; i < 100; i++) {
            status.surveyedAngles[i] = 0;
        }

        if (param && param.pov) {
            status.previousHeading = param.pov.heading;
        } else {
            try {
                var pov = svl.getPov();
                status.previousHeading = pov.heading;
            } catch (e) {
                status.previousHeading = 0;
            }
        }


        printCompletionRate();
    }

    function printCompletionRate () {
        // This method prints what percent of the intersection the user has observed.
        var completionRate = oPublic.getCompletionRate() * 100;
        completionRate = completionRate.toFixed(0, 10);
        completionRate = completionRate + "%";
        $divCurrentCompletionRate.html(completionRate);
        return this;
    }

    function oneDimensionalMorphology (arr, radius) {
        if (!radius) {
            radius = 5;
        }

        var newArr = new Array(arr.length);
        var len = arr.length;
        var i;
        var r;
        var rIndex;

        for (i = 0; i < len; i++) {
            newArr[i] = 0;
        }

        //
        // Expand
        for (i = 0; i < len; i++) {
            if (arr[i] == 1) {
                newArr[i] = 1;
                for (r = 1; r < radius; r++) {
                    rIndex = (i + r + len) % len;
                    newArr[rIndex] = 1;
                    rIndex = (i - r + len) % len;
                    newArr[rIndex] = 1;
                }
            }
        }

        var arr = $.extend(true, [], newArr);

        //
        // Contract
        for (i = 0; i < len; i++) {
            if (arr[i] == 0) {
                newArr[i] = 0;
                for (r = 1; r < radius; r++) {
                    rIndex = (i + r + len) % len;
                    newArr[rIndex] = 0;
                    rIndex = (i - r + len) % len;
                    newArr[rIndex] = 0;
                }
            }
        }

        return newArr;
    }

    function updateCompletionBar () {
        // This method updates the filler of the completion bar
        var completionRate = oPublic.getCompletionRate();
        var r;
        var g;
        var color;

        var colorIntensity = 255;
        if (completionRate < 0.5) {
            r = colorIntensity;
            g = parseInt(colorIntensity * completionRate * 2);
        } else {
            r = parseInt(colorIntensity * (1 - completionRate) * 2);
            g = colorIntensity;
        }

        color = 'rgba(' + r + ',' + g + ',0,1)';

        completionRate *=  100;
        completionRate = completionRate.toFixed(0, 10);
        completionRate -= 0.8;
        completionRate = completionRate + "%";
        $divCurrentCompletionBarFiller.css({
            background: color,
            width: completionRate
        });
    }

    function updateCompletionRate () {
        // This method updates the printed completion rate and the bar.
        printCompletionRate();
        updateCompletionBar();
    }

    ////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////
    oPublic.getCompletionRate = function () {
        // This method returns what percent of the intersection the user has observed.
        try {
            if (status.currentCompletionRate < 1) {
                var headingRange = 25;
                var pov = svl.getPOV();
                var heading = pov.heading;
                var headingMin = (heading - headingRange + 360) % 360;
                var headingMax = (heading + headingRange) % 360;
                var indexMin = Math.floor(headingMin / 360 * 100);
                var indexMax = Math.floor(headingMax / 360 * 100);
                var i = 0;
                if (indexMin < indexMax) {
                    for (i = indexMin; i < indexMax; i++) {
                        status.surveyedAngles[i] = 1;
                    }
                } else {
                    for (i = indexMin; i < 100; i++) {
                        status.surveyedAngles[i] = 1;
                    }
                    for (i = 0; i < indexMax; i++) {
                        status.surveyedAngles[i] = 1;
                    }
                }

                //
                // Added Aug 28th.
                // Todo. The part above is redundunt. Fix it later.
                // Fill in gaps in surveyedAngles
//                var indexCenter = Math.floor(heading / 360 * 100);
//                var previousHeading = status.previousHeading;
//                if (heading !== previousHeading) {
//                    var previousIndex = Math.floor(previousHeading / 360 * 100);
//                    var delta = heading - previousHeading;
//                    // if ((delta > 0 && delta < 359) || delta < -359) {
//                    if ((delta > 0 && delta < 300) || delta < -300) {
//                        // Fill in the gap from left to right
//                        for (i = previousIndex;;i++) {
//                            if (i == status.surveyedAngles.length) {
//                                i = 0;
//                            }
//                            status.surveyedAngles[i] = 1;
//                            if (i == indexCenter) {
//                                break;
//                            }
//
//                        }
//                    } else {
//                        // Fill in the gap from right to left.
//                        for (i = previousIndex;;i--) {
//                            if (i == -1) {
//                                i = status.surveyedAngles.length - 1;
//                            }
//                            status.surveyedAngles[i] = 1;
//                            if (i == indexCenter) {
//                                break;
//                            }
//
//                        }
//                    }
//                }

                // status.surveyedAngles = oneDimensionalMorphology(status.surveyedAngles);

                var total = status.surveyedAngles.reduce(function(a, b) {return a + b});
                status.currentCompletionRate = total / 100;

                status.previousHeading = heading;
                return total / 100;
            } else {
                return 1;
            }
        } catch (e) {
            return 0;
        }
    };

    oPublic.setCompletedHeading = function (range) {
        // This method manipulates the surveyed angle
        var headingMin = range[0];
        var headingMax = range[1];

        var indexMin = Math.floor(headingMin / 360 * 100);
        var indexMax = Math.floor(headingMax / 360 * 100);

        var i;
        for (i = indexMin; i < indexMax; i++) {
            status.surveyedAngles[i] = 1;
        }

        return this;
    };

    oPublic.updateCompletionRate = function () {
          return updateCompletionRate();
    };

    _init(param);
    return oPublic;
}

var svl = svl || {};

/**
 *
 * @param $
 * @param params
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function QualificationBadges ($, params) {
    var self = { className : 'QualificationBadges' };
    var properties = {
        badgeClassName : 'Badge',
        badgePlaceHolderImagePath : svl.rootDirectory + "/img/badges/EmptyBadge.png",
        busStopAuditorImagePath : svl.rootDirectory + "/img/badges/Onboarding_BusStopExplorerBadge_Orange.png",
        busStopExplorerImagePath : svl.rootDirectory + "/img/badges/Onboarding_BusStopInspector_Green.png"
    };
    var status = {};

    // jQuery elements
    var $badgeImageHolderBusStopAuditor;
    var $badgeImageHolderBusStopExplorer;

    ////////////////////////////////////////////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////////////////////////////////////////////
    function _init (params) {
        $badgeImageHolderBusStopAuditor = $("#BadgeImageHolder_BusStopAuditor");
        $badgeImageHolderBusStopExplorer = $("#BadgeImageHolder_BusStopExplorer");

        // Set the badge field with place holders.
        $badgeImageHolderBusStopAuditor.html('<img src="' + properties.badgePlaceHolderImagePath +
            '" class="' + properties.badgeClassName + '">');
        $badgeImageHolderBusStopExplorer.html('<img src="' + properties.badgePlaceHolderImagePath +
            '" class="' + properties.badgeClassName + '">');
    }


    ////////////////////////////////////////////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////////////////////////////////////////////
    self.giveBusStopAuditorBadge = function () {
        $badgeImageHolderBusStopAuditor.html('<img src="' + properties.busStopAuditorImagePath +
            '" class="' + properties.badgeClassName + '">');
        return this;
    };


    self.giveBusStopExplorerBadge = function () {
        $badgeImageHolderBusStopExplorer.html('<img src="' + properties.busStopExplorerImagePath +
            '" class="' + properties.badgeClassName + '">')
    };

    _init(params);
    return self;
}

var svl = svl || {};

/**
 *
 * @param $
 * @param params
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function RibbonMenu ($, params) {
    var self = { className: 'RibbonMenu' };
    var properties = {
        borderWidth : "3px",
        modeSwitchDefaultBorderColor : "rgba(200,200,200,0.75)",
        originalBackgroundColor: "white"
    };
    var status = {
            'disableModeSwitch' : false,
            'lockDisableModeSwitch' : false,
            'mode' : 'Walk',
            'selectedLabelType' : undefined
        };

    // jQuery DOM elements
    var $divStreetViewHolder;
    var $ribbonButtonBottomLines;
    var $ribbonConnector;
    var $spansModeSwitches;


    ////////////////////////////////////////
    // Private Functions
    ////////////////////////////////////////
    function _init () {
        //
        /// Set some of initial properties
        var browser = getBrowser();
        if (browser === 'mozilla') {
            properties.originalBackgroundColor = "-moz-linear-gradient(center top , #fff, #eee)";
        } else if (browser === 'msie') {
            properties.originalBackgroundColor = "#ffffff";
        } else {
            properties.originalBackgroundColor = "-webkit-gradient(linear, left top, left bottom, from(#fff), to(#eee))";
        }


        var labelColors = svl.misc.getLabelColors();

        //
        // Initialize the jQuery DOM elements
        if (svl.ui && svl.ui.ribbonMenu) {
          // $divStreetViewHolder = $("#Holder_StreetView");

          $divStreetViewHolder = svl.ui.ribbonMenu.streetViewHolder;
          // $ribbonButtonBottomLines = $(".RibbonModeSwitchHorizontalLine");
          $ribbonButtonBottomLines = svl.ui.ribbonMenu.bottonBottomBorders;
          // $ribbonConnector = $("#StreetViewLabelRibbonConnection");
          $ribbonConnector = svl.ui.ribbonMenu.connector;
          // $spansModeSwitches = $('span.modeSwitch');
          $spansModeSwitches = svl.ui.ribbonMenu.buttons;

          //
          // Initialize the color of the lines at the bottom of ribbon menu icons
          $.each($ribbonButtonBottomLines, function (i, v) {
              var labelType = $(v).attr("value");
              var color = labelColors[labelType].fillStyle;
              if (labelType === 'Walk') {
                  $(v).css('width', '56px');
              }

              $(v).css('border-top-color', color);
              $(v).css('background', color);
          });

          setModeSwitchBorderColors(status.mode);
          setModeSwitchBackgroundColors(status.mode);

          $spansModeSwitches.bind('click', modeSwitchClickCallback);
          $spansModeSwitches.bind({
              'mouseenter': modeSwitchMouseEnter,
              'mouseleave': modeSwitchMouseLeave
          });
        }
    }

    function modeSwitch (mode) {
        // This is a callback method that is invoked with a ribbon menu button click
        var labelType;

        if (typeof mode === 'string') {
            labelType = mode;
        } else {
            labelType = $(this).attr('val');
        }

        if (status.disableModeSwitch === false) {
            // Check if a bus stop sign is labeled or not.
            // If it is not, do not allow a user to switch to modes other than
            // Walk and StopSign.
            var labelColors;
            var ribbonConnectorPositions;
            var borderColor;

            //
            // Whenever the ribbon menu is clicked, cancel drawing.
            if ('canvas' in svl && svl.canvas && svl.canvas.isDrawing()) {
                svl.canvas.cancelDrawing();
            }


            labelColors = getLabelColors();
            ribbonConnectorPositions = getRibbonConnectionPositions();
            borderColor = labelColors[labelType].fillStyle;

            if ('map' in svl && svl.map) {
                if (labelType === 'Walk') {
                    // Switch to walking mode.
                    self.setStatus('mode', 'Walk');
                    self.setStatus('selectedLabelType', undefined);
                    if (svl.map) {
                      svl.map.modeSwitchWalkClick();
                    }
                } else {
                    // Switch to labeling mode.
                    self.setStatus('mode', labelType);
                    self.setStatus('selectedLabelType', labelType);
                    if (svl.map) {
                      svl.map.modeSwitchLabelClick();
                    }
                }
            }
            // Set border color

            if (svl.ui && svl.ui.ribbonMenu) {
              setModeSwitchBorderColors(labelType);
              setModeSwitchBackgroundColors(labelType);
              $ribbonConnector.css("left", ribbonConnectorPositions[labelType].labelRibbonConnection);
              $ribbonConnector.css("border-left-color", borderColor);
              $divStreetViewHolder.css("border-color", borderColor);
            }

            // Set the instructional message
            if (svl.overlayMessageBox) {
                svl.overlayMessageBox.setMessage(labelType);
            }
        }
    }

    function modeSwitchClickCallback () {
        if (status.disableModeSwitch === false) {
            var labelType;
            labelType = $(this).attr('val');

            //
            // If allowedMode is set, mode ('walk' or labelType) except for
            // the one set is not allowed
            if (status.allowedMode && status.allowedMode !== labelType) {
                return false;
            }

            //
            // Track the user action
            svl.tracker.push('Click_ModeSwitch_' + labelType);
            modeSwitch(labelType);
        }
    }

    function modeSwitchMouseEnter () {
        if (status.disableModeSwitch === false) {
            // Change the background color and border color of menu buttons
            // But if there is no Bus Stop label, then do not change back ground colors.
            var labelType = $(this).attr("val");

            //
            // If allowedMode is set, mode ('walk' or labelType) except for
            // the one set is not allowed
            if (status.allowedMode && status.allowedMode !== labelType) {
                return false;
            }
            setModeSwitchBackgroundColors(labelType);
            setModeSwitchBorderColors(labelType);
        }
    }

    function modeSwitchMouseLeave () {
        if (status.disableModeSwitch === false) {
            setModeSwitchBorderColors(status.mode);
            setModeSwitchBackgroundColors(status.mode);
        }
    }

    function setModeSwitchBackgroundColors (mode) {
        // background: -moz-linear-gradient(center top , #fff, #eee);
        // background: -webkit-gradient(linear, left top, left bottom, from(#fff), to(#eee));
        if (svl.ui && svl.ui.ribbonMenu) {
          var labelType;
          var labelColors;
          var borderColor;
          var browser;
          var backgroundColor;

          labelColors = getLabelColors();
          borderColor = labelColors[mode].fillStyle;

          $.each($spansModeSwitches, function (i, v) {
              labelType = $(v).attr('val');
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
          labelColors = getLabelColors();
          borderColor = labelColors[mode].fillStyle;

          $.each($spansModeSwitches, function (i, v) {
              labelType = $(v).attr('val');
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

    ////////////////////////////////////////
    // Public Functions
    ////////////////////////////////////////
    self.backToWalk = function () {
        // This function simulates the click on Walk icon
        modeSwitch('Walk');
        return this;
    };


    self.disableModeSwitch = function () {
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = true;
            if (svl.ui && svl.ui.ribbonMenu) {
              $spansModeSwitches.css('opacity', 0.5);
            }
        }
        return this;
    };

    self.disableLandmarkLabels = function () {
        // This function dims landmark labels and
        // also set status.disableLandmarkLabels to true
        if (svl.ui && svl.ui.ribbonMenu) {
          $.each($spansModeSwitches, function (i, v) {
              var labelType = $(v).attr('val');
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
    };

    self.enableModeSwitch = function () {
        // This method enables mode switch.
        if (!status.lockDisableModeSwitch) {
            status.disableModeSwitch = false;
            if (svl.ui && svl.ui.ribbonMenu) {
              $spansModeSwitches.css('opacity', 1);
            }
        }
        return this;
    };

    self.enableLandmarkLabels = function () {
      if (svl.ui && svl.ui.ribbonMenu) {
        $.each($spansModeSwitches, function (i, v) {
            var labelType = $(v).attr('val');
            $(v).css('opacity', 1);
        });
      }
      status.disableLandmarkLabels = false;
      return this;
    };


    self.lockDisableModeSwitch = function () {
        status.lockDisableModeSwitch = true;
        return this;
    };

    self.modeSwitch = function (labelType) {
        // This function simulates the click on a mode switch icon
        modeSwitch(labelType);
    };

    self.modeSwitchClick = function (labelType) {
        // This function simulates the click on a mode switch icon
        // Todo. Deprecated. Delete when you will refactor this code.
        modeSwitch(labelType);
    };


    self.getStatus = function(key) {
            if (key in status) {
                return status[key];
            } else {
              console.warn(self.className, 'You cannot access a property "' + key + '".');
              return undefined;
            }
    };

    self.setAllowedMode = function (mode) {
        // This method sets the allowed mode.
        status.allowedMode = mode;
        return this;
    };

    self.setStatus = function(name, value) {
        try {
            if (name in status) {
                if (name === 'disableModeSwitch') {
                    if (typeof value === 'boolean') {
                        if (value) {
                            self.disableModeSwitch();
                        } else {
                            self.enableModeSwitch();
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

    };

    self.unlockDisableModeSwitch = function () {
        status.lockDisableModeSwitch = false;
        return this;
    };


    _init(params);

    return self;
}

var svl = svl || {};

/**
 *
 * @param params
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function RightClickMenu (params) {
    var oPublic = {
        'className' : 'RightClickMenu'
        };
    var properties = {

        };
    var status = {
            'currentLabel' : undefined,
            'disableLabelDelete' : false,
            'disableMenuClose' : false,
            'disableMenuSelect' : false,
            'lockDisableMenuSelect' : false,
            'visibilityDeleteMenu' : 'hidden',
            'visibilityBusStopLabelMenu' : 'hidden',
            'visibilityBusStopPositionMenu' : 'hidden',
            'menuPosition' : {
                'x' : -1,
                'y' : -1
            }
        };
    var mouseStatus = {
            currX:0,
            currY:0,
            prevX:0,
            prevY:0,
            leftDownX:0,
            leftDownY:0,
            leftUpX:0,
            leftUpY:0,
            mouseDownOnBusStopLabelMenuBar : false,
            mouseDownOnBusStopPositionMenuBar : false
        };
    var canvas;
    var ribbonMenu;

        // jQuery doms
    // Todo. Do not hard cord dom ids.
    var $divLabelMenu;
    var $divLabelMenuBar;
    var $divDeleteLabelMenu;
    var $divHolderRightClickMenu;
    var $radioBusStopSignTypes;
    var $deleteMenuDeleteButton;
    var $deleteMenuCancelButton;
    var $divBusStopLabelMenuItems;
    var $divBusStopPositionMenu;
    var $divBusStopPositionMenuBar;
    var $divBusStopPositionMenuItems;
    var $btnBusStopPositionMenuBack;
    var $divHolderLabelMenuClose;
    var $divHolderPositionMenuClose;
    var $menuBars;
    var $spanHolderBusStopLabelMenuQuestionMarkIcon;
    var $spanHolderBusStopPositionMenuQuestionMarkIcon;


    ////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////
    function init (params) {
        canvas = params.canvas;
        ribbonMenu = params.ribbonMenu;

        // Todo. Do not hard cord dom ids.
        $divLabelMenu = $("div#labelDrawingLayer_LabelMenu");
        $divLabelMenuBar = $("#labelDrawingLayer_LabelMenuBar");
        $divDeleteLabelMenu = $("div#LabelDeleteMenu");
        $divHolderRightClickMenu = $("div#Holder_RightClickMenu");
        $radioBusStopSignTypes = $("input.Radio_BusStopType");
        $deleteMenuDeleteButton = $("button#LabelDeleteMenu_DeleteButton");
        $deleteMenuCancelButton = $("button#LabelDeleteMenu_CancelButton");

        $divBusStopLabelMenuItems = $(".BusStopLabelMenuItem");
        $divHolderLabelMenuClose = $("#Holder_BusStopLabelMenuOptionCloseIcon");


        // Bus stop relative position menu
        $divBusStopPositionMenu = $("#BusStopPositionMenu");
        $divBusStopPositionMenuBar = $("#BusStopPositionMenu_MenuBar");
        $divBusStopPositionMenuItems = $(".BusStopPositionMenu_MenuItem");
        $btnBusStopPositionMenuBack = $("#BusStopPositinoMenu_BackButton");
        $divHolderPositionMenuClose = $("#Holder_BusStopPositionMenuCloseIcon");

        $menuBars = $(".RightClickMenuBar");

        $spanHolderBusStopLabelMenuQuestionMarkIcon = $('.Holder_BusStopLabelMenuQuestionMarkIcon');
        $spanHolderBusStopPositionMenuQuestionMarkIcon = $('.Holder_BusStopPositionMenuQuestionMarkIcon');

        // Attach listenters
        // $radioBusStopSignTypes.bind('mousedown', radioBusStopSignTypeMouseUp);
        // $deleteMenuDeleteButton.bind('mousedown', deleteMenuDeleteClicked);
        // $deleteMenuCancelButton.bind('mousedown', deleteMenuCancelClicked);

        // Bus stop label menu listeners
        $divBusStopLabelMenuItems.bind('mouseup', divBusStopLabelMenuItemsMouseUp);
        $divBusStopLabelMenuItems.bind('mouseenter', divBusStopLabelMenuItemsMouseEnter);
        $divBusStopLabelMenuItems.bind('mouseleave', divBusStopLabelMenuItemsMouseLeave);

        // Bus stop label menu menu-bar
        $divLabelMenuBar.bind('mousedown', divBusStopLabelMenuBarMouseDown);
        $divLabelMenuBar.bind('mouseup', divBusStopLabelMenuBarMouseUp);
        $divLabelMenuBar.bind('mousemove', divBusStopLabelMenuBarMouseMove);
        $divHolderLabelMenuClose.bind('click', divBusHolderLabelMenuCloseClicked);
        $divHolderLabelMenuClose.bind('mouseenter', divBusHolderLabelMenuCloseMouseEnter);
        $divHolderLabelMenuClose.bind('mouseleave', divBusHolderLabelMenuCloseMouseLeave);

        // Position menu listeners
        $divBusStopPositionMenuItems.bind('mouseup', divBusStopPositionMenuItemsMouseUp);
        $divBusStopPositionMenuItems.bind('mouseenter', divBusStopPositionMenuItemsMouseEnter);
        $divBusStopPositionMenuItems.bind('mouseleave', divBusStopPositionMenuItemsMouseLeave);

        $divBusStopPositionMenuBar.bind('mousedown', divBusStopPositionMenuBarMouseDown);
        $divBusStopPositionMenuBar.bind('mouseup', divBusStopPositionMenuBarMouseUp);
        $divBusStopPositionMenuBar.bind('mousemove', divBusStopPositionMenuBarMouseMove);
        $divHolderPositionMenuClose.bind('click', divBusHolderPositionMenuCloseClicked);
        $divHolderPositionMenuClose.bind('mouseenter', divBusHolderPositionMenuCloseMouseEnter);
        $divHolderPositionMenuClose.bind('mouseleave', divBusHolderPositionMenuCloseMouseLeave);


        // Question marks
        $spanHolderBusStopLabelMenuQuestionMarkIcon.bind({
            'mouseenter' : questionMarkMouseEnter,
            'mouseleave' : questionMarkMouseLeave,
            'mouseup' : questionMarkMouseUp
        });
        $spanHolderBusStopPositionMenuQuestionMarkIcon.bind({
            'mouseenter' : questionMarkMouseEnter,
            'mouseleave' : questionMarkMouseLeave,
            'mouseup' : questionMarkMouseUp
        });
        // menu bars
        $menuBars.bind('mouseenter', menuBarEnter);


        $btnBusStopPositionMenuBack.bind('click', busStopPositionMenuBackButtonClicked);
    }

    function questionMarkMouseEnter (e) {
        $(this).find('.tooltip').css('visibility', 'visible');
    }

    function questionMarkMouseLeave () {
        $(this).find('.tooltip').css('visibility', 'hidden');
    }

    function questionMarkMouseUp (e) {
        // Stopping propagation
        // http://stackoverflow.com/questions/13988427/add-event-listener-to-child-whose-parent-has-event-disabled
        e.stopPropagation();
        var category = $(this).parent().attr('value');
        myExamples.show(category);
    }

    function radioBusStopSignTypeMouseUp (e) {
        // This function is invoked when a user click a radio button in
        // the menu.
        // Show current bus stop label's tag and set subLabelType
        // (e.g. one-leg stop sign, two-leg stop sign)
        // canvas.getCurrentLabel().setStatus('visibilityTag', 'visible');
        oPublic.hideBusStopType();

        // Set the subLabelType of the label (e.g. "StopSign_OneLeg"
        var subLabelType = $(this).attr("val");
        canvas.getCurrentLabel().setSubLabelDescription(subLabelType);
        canvas.clear().render();

        // Snap back to walk mode.
        myMenu.backToWalk();
    }


    ////////////////////////////////////////
    // Private Functions (Bus stop label menu)
    ////////////////////////////////////////
    function menuBarEnter () {
        $(this).css('cursor', 'url(' + svl.rootDirectory + "/img/cursors/openhand.cur) 4 4, move");
    }


    function divBusStopLabelMenuItemsMouseUp () {
        if (!status.disableMenuSelect) {
            // This function is invoked when a user click on a bus stop label menu
            var color, iconImagePath, subLabelType, $menuItem;
            color = getLabelColors()['StopSign'].fillStyle;
            // currentLabel.setStatus('visibilityTag', 'visible');


            // Give a slight mouse click feedback to a user
            $menuItem = $(this);
            $menuItem.css('background','transparent');

            setTimeout(function () {
                $menuItem.css('background', color);
                setTimeout(function() {
                    $menuItem.css('background', 'transparent');

                    // Hide the menu
                    oPublic.hideBusStopType();

                    subLabelType = $menuItem.attr("value");
                    if (!subLabelType) {
                        subLabelType = 'StopSign';
                    }

                    // Set the subLabelType of the label (e.g. "StopSign_OneLeg"
                    status.currentLabel.setSubLabelDescription(subLabelType);
                    iconImagePath = getLabelIconImagePath()[subLabelType].iconImagePath;
                    status.currentLabel.setIconPath(iconImagePath);

                    canvas.clear().render();

                    showBusStopPositionMenu();
                }, 100)
            },100);
        }
    }


    function divBusStopLabelMenuItemsMouseEnter () {
        if (!status.disableMenuSelect) {
            var color = getLabelColors()['StopSign'].fillStyle;
            $(this).css({
                'background': color,
                'cursor' : 'pointer'
            });
            return this;
        }
        return false;
    }


    function divBusStopLabelMenuItemsMouseLeave () {
        if (!status.disableMenuSelect) {
            $(this).css({
                'background' : 'transparent',
                'cursor' : 'default'
            });
            return this;
        }
    }


    //
    // Bus stop label menu menu bar
    //
    function divBusStopLabelMenuBarMouseDown () {
        mouseStatus.mouseDownOnBusStopLabelMenuBar = true;
        $(this).css('cursor', 'url(' + svl.rootDirectory + "/img/cursors/closedhand.cur) 4 4, move");
    }


    function divBusStopLabelMenuBarMouseUp () {
        mouseStatus.mouseDownOnBusStopLabelMenuBar = false;
        $(this).css('cursor', 'url(' + svl.rootDirectory + "/img/cursors/openhand.cur) 4 4, move");
    }


    function divBusStopLabelMenuBarMouseMove (e) {
        if (mouseStatus.mouseDownOnBusStopLabelMenuBar) {
            var left = $divLabelMenu.css('left');
            var top = $divLabelMenu.css('top');
            var dx, dy;

            top = parseInt(top.replace("px", ""));
            left = parseInt(left.replace("px",""));

            dx = e.pageX - mouseStatus.prevX;
            dy = e.pageY - mouseStatus.prevY;
            left += dx;
            top += dy;

            // console.log(left, top, dx, dy);

            $divLabelMenu.css({
                'left' : left,
                'top' : top
            });
        }
        mouseStatus.prevX = e.pageX;
        mouseStatus.prevY = e.pageY;
    }


    function divBusHolderLabelMenuCloseClicked () {
        // Label menu close is clicked
        // First close the menu, then delete the generated label.
        if (!status.disableMenuClose) {
            var prop;

            // Check if Bus stop type and bus stop position is set.
            // If not, set the label as deleted, so when a user do
            // Undo -> Redo the label will be treated as deleted and won't show up
            if (status.currentLabel) {
                prop = status.currentLabel.getProperties();
                if (prop.labelProperties.busStopPosition === 'DefaultValue' ||
                    prop.labelProperties.subLabelDescription === 'DefaultValue') {
                    myCanvas.removeLabel(status.currentLabel);
                    myActionStack.pop();
                }
            }
            mouseStatus.mouseDownOnBusStopLabelMenuBar = false;
            oPublic.hideBusStopType();
            canvas.enableLabeling();
            myMenu.setStatus('disableModeSwitch', false);
        }
    }


    function divBusHolderLabelMenuCloseMouseEnter () {
        if (!status.disableMenuClose) {
            $(this).css('cursor', 'pointer');
        }
    }


    function divBusHolderLabelMenuCloseMouseLeave () {
        $(this).css('cursor', 'default');
    }


    ////////////////////////////////////////
    // Private Functions (Bus stop position menu)
    ////////////////////////////////////////
    function divBusStopPositionMenuItemsMouseUp () {
        if (!status.disableMenuSelect) {
            // Set label values
            var busStopPosition, color, currentLabel, $menuItem;
            color = getLabelColors()['StopSign'].fillStyle;

            status.currentLabel.setStatus('visibilityTag', 'visible');

            $menuItem = $(this);
            $menuItem.css('background','transparent');

            // Set bus stop position (e.g. Next
            busStopPosition = $menuItem.attr('value');
            status.currentLabel.setBusStopPosition(busStopPosition);

            setTimeout(function () {
                $menuItem.css('background', color);
                setTimeout(function() {
                    $menuItem.css('background', 'transparent');

                    // Close the menu
                    hideBusStopPositionMenu();
                    // Snap back to walk mode.
                    myMap.enableWalking();
                    myMenu.backToWalk();
                    // myMap.setStatus('disableWalking', false);
                }, 100)
            },100);
        }
    }


    function divBusStopPositionMenuItemsMouseEnter () {
        if (!status.disableMenuSelect) {
            var color = getLabelColors()['StopSign'].fillStyle;
            $(this).css({
                'background': color,
                'cursor' : 'pointer'
            });
            return this;
        }
    }


    function divBusStopPositionMenuItemsMouseLeave () {
        if (!status.disableMenuSelect) {
            $(this).css({
                'background': 'transparent',
                'cursor' : 'default'
            });
            return this;
        }
    }


    function divBusHolderPositionMenuCloseMouseEnter () {
        if (!status.disableMenuClose) {
            $(this).css({
                'cursor' : 'pointer'
            });
        }
    }


    function divBusHolderPositionMenuCloseMouseLeave () {
        $(this).css({
            'cursor' : 'default'
        });
    }


    function divBusHolderPositionMenuCloseClicked () {
        // Label position menu close is clicked
        // First close the menu, then delete the generated label.
        if (!status.disableMenuClose &&
            status.currentLabel) {
            var prop;

            // Check if Bus stop type and bus stop position is set.
            // If not, set the label as deleted, so when a user do
            // Undo -> Redo the label will be treated as deleted and won't show up
            prop = status.currentLabel.getProperties();
            if (prop.labelProperties.busStopPosition === 'DefaultValue' ||
                prop.labelProperties.subLabelDescription === 'DefaultValue') {
                myCanvas.removeLabel(status.currentLabel);
                myActionStack.pop();
            }

            // Hide the menu
            mouseStatus.mouseDownOnBusStopPositionMenuBar = false;
            hideBusStopPositionMenu();
            canvas.enableLabeling();
            myMenu.setStatus('disableModeSwitch', false);
        }
    }


    //
    // Menu bar
    //
    function divBusStopPositionMenuBarMouseDown (e) {
        mouseStatus.mouseDownOnBusStopPositionMenuBar = true;
        $(this).css('cursor', 'url(' + svl.rootDirectory + "/img/cursors/closedhand.cur) 4 4, move");
    }


    function divBusStopPositionMenuBarMouseUp (e) {
        mouseStatus.mouseDownOnBusStopPositionMenuBar = false;
        $(this).css('cursor', 'url(' + svl.rootDirectory + "/img/cursors/openhand.cur) 4 4, move");
    }


    function divBusStopPositionMenuBarMouseMove (e) {
        if (mouseStatus.mouseDownOnBusStopPositionMenuBar) {
            var left = $divBusStopPositionMenu.css('left');
            var top = $divBusStopPositionMenu.css('top');
            var dx, dy;

            top = parseInt(top.replace("px", ""));
            left = parseInt(left.replace("px",""));

            dx = e.pageX - mouseStatus.prevX;
            dy = e.pageY - mouseStatus.prevY;
            left += dx;
            top += dy;

            // console.log(left, top, dx, dy);

            $divBusStopPositionMenu.css({
                'left' : left,
                'top' : top
            });
        }
        mouseStatus.prevX = e.pageX;
        mouseStatus.prevY = e.pageY;
    }

    function hideBusStopPositionMenu () {
        status.visibilityBusStopPositionMenu = 'hidden';

        $divHolderRightClickMenu.css('visibility', 'hidden');
        $divBusStopPositionMenu.css('visibility', 'hidden');

        if (oPublic.isAllClosed()) {
            canvas.setStatus('disableLabeling', false);
            myMenu.setStatus('disableModeSwitch', false);

            status.disableLabelDelete = false;
            status.currentLabel = undefined;

            myActionStack.unlockDisableRedo().enableRedo().lockDisableRedo();
            myActionStack.unlockDisableUndo().enableUndo().lockDisableUndo();
            myForm.unlockDisableSubmit().enableSubmit().lockDisableSubmit();
            myForm.unlockDisableNoBusStopButton().enableNoBusStopButton().lockDisableNoBusStopButton();
        }
    }


    function showBusStopPositionMenu () {
        var menuX = status.menuPosition.x,
            menuY = status.menuPosition.y;
        status.visibilityBusStopPositionMenu = 'visible';

        // Show the right-click menu layer
        // $divHolderRightClickMenu.css('visibility', 'visible');


        // Set the menu bar color
        $divBusStopPositionMenuBar.css({
            'background' : getLabelColors()['StopSign'].fillStyle
        });


        // If menu position is to low or to much towards right,
        // adjust the position
        if (menuX > 400) {
            menuX -= 300;
        }
        if (menuY > 300) {
            menuY -= 200;
        }

        // Show the bus stop position menu
        $divBusStopPositionMenu.css({
            'visibility': 'visible',
            'position' : 'absolute',
            'left' : menuX,
            'top' : menuY,
            'z-index' : 4
        });

        canvas.setStatus('visibilityMenu', 'visible');
        canvas.disableLabeling();
        myMenu.setStatus('disableModeSwitch', true);
        myActionStack.unlockDisableRedo().disableRedo().lockDisableRedo();
        myActionStack.unlockDisableUndo().disableUndo().lockDisableUndo();
    }


    //
    // Back button
    //
    function busStopPositionMenuBackButtonClicked () {
        // Hide bus stop position menu and show sign label menu.
        var currentLabel = status.currentLabel;
        hideBusStopPositionMenu();
        oPublic.showBusStopType(currentLabel.getCoordinate().x, currentLabel.getCoordinate().y);
    }


    ////////////////////////////////////////
    // Private Functions (Deleting labels)
    ////////////////////////////////////////
    function deleteMenuDeleteClicked() {
        canvas.removeLabel(canvas.getCurrentLabel());
        oPublic.hideDeleteLabel();
        myActionStack.push('deleteLabel', canvas.getCurrentLabel());
    }


    function deleteMenuCancelClicked () {
        oPublic.hideDeleteLabel();
    }


    ////////////////////////////////////////
    // oPublic functions
    ////////////////////////////////////////
    oPublic.close = function () {
        // Esc pressed. close all menu windows
        divBusHolderLabelMenuCloseClicked();
        divBusHolderPositionMenuCloseClicked();
    };


    oPublic.disableMenuClose = function () {
        status.disableMenuClose = true;
        return this;
    };


    oPublic.disableMenuSelect = function () {
        if (!status.lockDisableMenuSelect) {
            status.disableMenuSelect = true;
        }
        return this;
    };


    oPublic.enableMenuClose = function () {
        status.disableMenuClose = false;
        return this;
    };


    oPublic.enableMenuSelect = function () {
        if (!status.lockDisableMenuSelect) {
            status.disableMenuSelect = false;
        }
        return this;
    };


    oPublic.getMenuPosition = function () {
        return {
            x : status.menuPosition.x,
            y : status.menuPosition.y
        };
    };


    oPublic.hideBusStopPosition = function () {
        // Hide the right click menu for choosing a bus stop position.
        hideBusStopPositionMenu();
        return this;
    };


    oPublic.hideBusStopType = function () {
        // Hide the right click menu for choosing a bus stop type.

        // Hide the right-click menu layer
        $divHolderRightClickMenu.css('visibility', 'hidden');

        // Hide the bus stop label menu
        $divLabelMenu.css('visibility', 'hidden');
        status.visibilityBusStopLabelMenu = 'hidden';

        canvas.setStatus('visibilityMenu', 'hidden');

        if (oPublic.isAllClosed()) {
            myActionStack.unlockDisableRedo().enableRedo().lockDisableRedo();
            myActionStack.unlockDisableUndo().enableUndo().lockDisableUndo();
            myForm.unlockDisableSubmit().disableSubmit().lockDisableSubmit();
            myForm.unlockDisableNoBusStopButton().disableNoBusStopButton().lockDisableNoBusStopButton();
        }
    };


    oPublic.hideDeleteLabel = function () {
        // Hide the right-click menu layer
        $divHolderRightClickMenu.css('visibility', 'hidden');
        status.visibilityDeleteMenu = 'hidden';

        $divDeleteLabelMenu.css('visibility', 'hidden');
        canvas.setStatus('visibilityMenu', 'hidden');

        if (oPublic.isAllClosed()) {
            canvas.enableLabeling();
            myMenu.setStatus('disableModeSwitch', false);
        }
    };


    oPublic.isAllClosed = function () {
        // This function checks if all the menu windows are hidden and return true/false
        if (status.visibilityBusStopLabelMenu === 'hidden' &&
            status.visibilityDeleteMenu === 'hidden' &&
            status.visibilityBusStopPositionMenu === 'hidden') {
            return true;
        } else {
            return false;
        }
    };


    oPublic.isAnyOpen = function () {
        // This function checks if any menu windows is open and return true/false
        return !oPublic.isAllClosed();
    };


    oPublic.lockDisableMenuSelect = function () {
        status.lockDisableMenuSelect = true;
        return this;
    };

    oPublic.setStatus = function (key, value) {
        if (key in status) {
            if (key === 'disableMenuClose') {
                if (typeof value === 'boolean') {
                    if (value) {
                        oPublic.enableMenuClose();
                    } else {
                        oPublic.disableMenuClose();
                    }
                    return this;
                } else {
                    return false;
                }
            } else {
                status[key] = value;
                return this;
            }
        }
        return false;
    };


    oPublic.showBusStopType = function (x, y) {
        status.currentLabel = canvas.getCurrentLabel();

        if (status.currentLabel &&
            status.currentLabel.getLabelType() === 'StopSign') {
            // Show bus stop label menu
            var menuX, menuY;

            // Show the right-click menu layer
            $divHolderRightClickMenu.css('visibility', 'visible');
            status.visibilityBusStopLabelMenu = 'visible';

            // Set the menu bar color
            $divLabelMenuBar.css({
                'background' : getLabelColors()['StopSign'].fillStyle
            });


            menuX = x + 25;
            menuY = y + 25;

            // If menu position is to low or to much towards right,
            // adjust the position
            if (menuX > 400) {
                menuX -= 300;
            }
            if (menuY > 300) {
                menuY -= 200;
            }

            status.menuPosition.x = menuX;
            status.menuPosition.y = menuY;

            // Show the bus stop label menu
            $divLabelMenu.css({
                'visibility' : 'visible',
                'position' : 'absolute',
                'left' : menuX,
                'top' : menuY,
                'z-index' : 4
            });
            status.visibilityBusStopLabelMenu = 'visible';

            canvas.setStatus('visibilityMenu', 'visible');
            canvas.setStatus('disableLabeling', true);
            canvas.disableLabeling();
            myMap.setStatus('disableWalking', true);
            myMenu.setStatus('disableModeSwitch', true);
        }

    };


    oPublic.showDeleteLabel = function (x, y) {
        // This function shows a menu to delete a label that is in
        // canvas and under the current cursor location (x, y)
        var menuX, menuY;

        if (!status.disableLabelDelete) {
            // Show the right-click menu layer
            $divHolderRightClickMenu.css('visibility', 'visible');


            menuX = x - 5;
            menuY = y - 5

            $divDeleteLabelMenu.css({
                'visibility' : 'visible',
                'position' : 'absolute',
                'left' : menuX,
                'top' : menuY,
                'z-index' : 4
            });
            status.visibilityDeleteMenu = 'visible';

            status.visibilityMenu = 'visible';
            status.disableLabeling = true;
            // myMap.setStatus('disableWalking', true);
            myMenu.setStatus('disableModeSwitch', true);
        }
    };


    oPublic.unlockDisableMenuSelect = function () {
        status.lockDisableMenuSelect = false;
        return this;
    };

    ////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////
    init(params);
    return oPublic;
}

var svl = svl || {};

/**
 * A MissionDescription module
 * @param $
 * @param params
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function StatusMessage ($, params) {
    var self = { className : 'StatusMessage' },
        properties = {},
        status = {};

    function _init (params) {    }

    function animate() {
        svl.ui.statusMessage.holder.removeClass('bounce animated').addClass('bounce animated').one('webkitAnimationEnd mozAnimationEnd MSAnimationEnd oanimationend animationend', function(){
            $(this).removeClass('bounce animated');
        });
//        $('#animationSandbox').removeClass().addClass('bounce animated').one('webkitAnimationEnd mozAnimationEnd MSAnimationEnd oanimationend animationend', function(){
//              $(this).removeClass();
//            });
    }

    function restoreDefault () {
        setBackgroundColor('rgb(255, 255, 255)');
        setCurrentStatusDescription('Your mission is to find and label all the accessibility attributes in the sidewalks and streets.');
        setCurrentStatusTitle('Mission:');
    }
    /**
     *
     */
    function setBackgroundColor (rgb) {
        svl.ui.statusMessage.holder.css('background', rgb);
    }

    /**
     * The method sets what's shown in the current status pane in the interface
     * @param description {string} A string (or html) to put.
     * @returns {self}
     */
    function setCurrentStatusDescription (description) {
      svl.ui.statusMessage.description.html(description);
      return this;
    }

    function setCurrentStatusTitle (title) {
        svl.ui.statusMessage.title.html(title);
        return this;
    }

    self.animate = animate;
    self.restoreDefault = restoreDefault;
    self.setBackgroundColor = setBackgroundColor;
    self.setCurrentStatusDescription = setCurrentStatusDescription;
    self.setCurrentStatusTitle = setCurrentStatusTitle;
    _init(params);
    return self;
}

var svl = svl || {};

/**
 * LocalStorage class constructor
 * @param JSON
 * @param params
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
    function refresh () {
        _init();
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
    self.refresh = refresh;
    self.set = set;
    _init();
    return self;
}
var svl = svl || {};

/**
 * Task constructor
 * @param $
 * @param param
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Task ($) {
    var self = {className: 'Task'},
        taskSetting,
        previousTasks = [],
        lat, lng;

    /** Save the task */
    function save () { svl.storage.set("task", taskSetting); }

    /** Load the task */
    function load () {
        var map = svl.storage.get("map");
        taskSetting = svl.storage.get("task");

        if (map) {
            lat = map.latlng.lat;
            lng = map.latlng.lng;
        }
        return taskSetting ? true : false;
    }

    /**  Get a next task */
    function nextTask (streetEdgeId) {
        var data = {street_edge_id: streetEdgeId },
            len = taskSetting.features[0].geometry.coordinates.length - 1,
            latEnd = taskSetting.features[0].geometry.coordinates[len][1],
            lngEnd = taskSetting.features[0].geometry.coordinates[len][0];
        $.ajax({
            // async: false,
            // contentType: 'application/json; charset=utf-8',
            url: "/audit/task/next?streetEdgeId=" + streetEdgeId + "&lat=" + latEnd + "&lng=" + lngEnd,
            type: 'get',
            success: function (task) {
                var len = task.features[0].geometry.coordinates.length - 1,
                    lat1 = task.features[0].geometry.coordinates[0][1],
                    lng1 = task.features[0].geometry.coordinates[0][0],
                    lat2 = task.features[0].geometry.coordinates[len][1],
                    lng2 = task.features[0].geometry.coordinates[len][0],
                    d1 = svl.util.math.haversine(lat1, lng1, latEnd, lngEnd),
                    d2 = svl.util.math.haversine(lat2, lng2, latEnd, lngEnd);

                if (d1 > 10 && d2 > 10) {
                    // If the starting point of the task is far away, jump there.
                    svl.setPosition(lat1, lng1);
                } else if (d2 < d1) {
                    // Flip the coordinates of the line string if the last point is closer to the end point of the current street segment.
                    task.features[0].geometry.coordinates.reverse();
                }
                set(task);
                render();
            },
            error: function (result) {
                throw result;
            }
        });
    }

    /** End the current task */
    function endTask () {
        svl.statusMessage.animate();
        svl.statusMessage.setCurrentStatusTitle("Great!");
        svl.statusMessage.setCurrentStatusDescription("You have finished auditing accessibility of this street and sidewalks. Keep it up!");
        svl.statusMessage.setBackgroundColor("rgb(254, 255, 223)");
        svl.tracker.push("TaskEnd");

        // Push the data into the list
        previousTasks.push(taskSetting);

        if (!('user' in svl)) {
            // Prompt a user who's not logged in to sign up/sign in.
            svl.popUpMessage.setTitle("You've completed the first accessibility audit!");
            svl.popUpMessage.setMessage("Do you want to create an account to keep track of your progress?");
            svl.popUpMessage.appendButton('<button id="pop-up-message-sign-up-button">Let me sign up!</button>', function () {
                // Store the data in LocalStorage.
                var data = svl.form.compileSubmissionData(),
                    staged = svl.storage.get("staged");
                staged.push(data);
                svl.storage.set("staged", staged);

                $("#sign-in-modal").addClass("hidden");
                $("#sign-up-modal").removeClass("hidden");
                $('#sign-in-modal-container').modal('show');
            });
            svl.popUpMessage.appendButton('<button id="pop-up-message-cancel-button">Nope</button>', function () {
                svl.user = new User({username: 'Anon accessibility auditor'});

                // Submit the data as an anonymous user.
                var data = svl.form.compileSubmissionData();
                svl.form.submit(data);
            });
            svl.popUpMessage.appendHTML('<br /><a id="pop-up-message-sign-in"><small><span style="color: white; ' +
                'text-decoration: underline;">I do have an account! Let me sign in.</span></small></a>', function () {
                var data = svl.form.compileSubmissionData(),
                    staged = svl.storage.get("staged");
                staged.push(data);
                svl.storage.set("staged", staged);

                $("#sign-in-modal").removeClass("hidden");
                $("#sign-up-modal").addClass("hidden");
                $('#sign-in-modal-container').modal('show');
            });
            svl.popUpMessage.setPosition(0, 260, '100%');
            svl.popUpMessage.show(true);
        } else {
            // Submit the data.
            var data = svl.form.compileSubmissionData(),
                staged = svl.storage.get("staged");

            if (staged.length > 0) {
                staged.push(data);
                svl.form.submit(staged);
                svl.storage.set("staged", []);  // Empty the staged data.
            } else {
                svl.form.submit(data);
            }
        }
        nextTask(getStreetEdgeId());
    }

    /** Get geometry */
    function getGeometry () {
        if (taskSetting) {
            return taskSetting.features[0].geometry;
        }
    }

    /** Returns the street edge id of the current task. */
    function getStreetEdgeId () { return taskSetting.features[0].properties.street_edge_id; }

    /** Returns the task start time */
    function getTaskStart () { return taskSetting.features[0].properties.task_start; }

    /** Returns the starting location */
    function initialLocation() { return taskSetting ? { lat: lat, lng: lng } : null; }

    /**
     * This method checks if the task is done or not by assessing the
     * current distance and the ending distance.
     */
    function isAtEnd (lat, lng, threshold) {
        if (taskSetting) {
            var d, len = taskSetting.features[0].geometry.coordinates.length - 1,
                latEnd = taskSetting.features[0].geometry.coordinates[len][1],
                lngEnd = taskSetting.features[0].geometry.coordinates[len][0];

            if (!threshold) { threshold = 10; } // 10 meters
            d = svl.util.math.haversine(lat, lng, latEnd, lngEnd);
            console.debug('Distance to the end:' , d);
            return d < threshold;
        }
    }

    /**
     * Reference: https://developers.google.com/maps/documentation/javascript/shapes#polyline_add
     */
    function render() {
        if ('map' in svl && google) {
            var gCoordinates = taskSetting.features[0].geometry.coordinates.map(function (coord) {
                return new google.maps.LatLng(coord[1], coord[0]);
            });
            var path = new google.maps.Polyline({
                path: gCoordinates,
                geodesic: true,
                strokeColor: '#00FF00',
                strokeOpacity: 1.0,
                strokeWeight: 2
            });
            path.setMap(svl.map.getMap());
        }
    }

    /** This method takes a task parameters in geojson format. */
    function set(json) {
        taskSetting = json;
        lat = taskSetting.features[0].geometry.coordinates[0][1];
        lng = taskSetting.features[0].geometry.coordinates[0][0];
    }

    self.endTask = endTask;
    self.getGeometry = getGeometry;
    self.getStreetEdgeId = getStreetEdgeId;
    self.getTaskStart = getTaskStart;
    self.load = load;
    self.set = set;
    self.initialLocation = initialLocation;
    self.isAtEnd = isAtEnd;
    self.render = render;
    self.save = save;
    self.nextTask = nextTask;
    return self;
}

var svl = svl || {};

/**
 *
 * @param $
 * @param param
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Tooltip ($, param) {
    var self = {className: 'Tooltip'};
    var properties = {};
    var status = {};

    var $divToolTip;

    function _init(param) {
        $divToolTip = $(param.domIds.tooltipHolder);
    }

    self.show = function (message) {
        $divToolTip.html(message);
        $divToolTip.css('visibility', 'visible');
    };

    self.hide = function () {
        $divToolTip.css('visibility', 'hidden');
    };

    _init(param);
    return self;
}

var svl = svl || {};

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

    /**
     * Returns actions
     */
    function getActions () {
        return actions;
    }

    /**
     * Load the actions in storage
     */
    function load () {
        actions = svl.storage.get("tracker");
    }

    /**
     * This function pushes action type, time stamp, current pov, and current panoId into actions list.
     */
    function push (action, param) {
        var pov, latlng, panoId, note, temporaryLabelId;

        if (param) {
            if (('x' in param) && ('y' in param)) {
                note = 'x:' + param.x + ',y:' + param.y;
            } else if ('TargetPanoId' in param) {
                note = param.TargetPanoId;
            } else if ('RadioValue' in param) {
                note = param.RadioValue;
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
            } else {
                note = "";
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
            pov = svl.getPOV();
        } catch (err) {
            pov = {
                heading: null,
                pitch: null,
                zoom: null
            }
        }

        try {
            latlng = getPosition();
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
            panoId = getPanoId();
        } catch (err) {
            panoId = null;
        }

        var now = new Date(),
            timestamp = now.getUTCFullYear() + "-" + (now.getUTCMonth() + 1) + "-" + now.getUTCDate() + " " + now.getUTCHours() + ":" + now.getUTCMinutes() + ":" + now.getUTCSeconds() + "." + now.getUTCMilliseconds();

        actions.push({
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
        });
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

    /**
     * Save the actions in the storage
     */
    function save () {
        svl.storage.set("tracker", actions);
    }

    self.getActions = getActions;
//    self.load = load;
    self.push = push;
    self.refresh = refresh;
//    self.save = save;
    return self;
}

var svl = svl || {};

/**
 * A UI class
 * @param $
 * @param params
 * @returns {{moduleName: string}}
 * @constructor
 * @memberof svl
 */
function UI ($, params) {
    var self = {moduleName: 'MainUI'};
    self.streetViewPane = {};
    params = params || {};

    ////////////////////////////////////////
    // Private Functions
    ////////////////////////////////////////
    function _init (params) {
      // Todo. Use better templating techniques rather so it's prettier!

      self.actionStack = {};
      self.actionStack.holder = $("#action-stack-control-holder");
      self.actionStack.holder.append('<button id="undo-button" class="button action-stack-button" value="Undo"><img src="' + svl.rootDirectory + 'img/icons/Icon_Undo.png" class="action-stack-icons" alt="Undo" /><br /><small>Undo</small></button>');
      self.actionStack.holder.append('<button id="redo-button" class="button action-stack-button" value="Redo"><img src="' + svl.rootDirectory + 'img/icons/Icon_Redo.png" class="action-stack-icons" alt="Redo" /><br /><small>Redo</small></button>');
      self.actionStack.redo = $("#redo-button");
      self.actionStack.undo = $("#undo-button");

      // LabeledLandmarkFeedback DOMs
//      $labelCountCurbRamp = $("#LabeledLandmarkCount_CurbRamp");
//      $labelCountNoCurbRamp = $("#LabeledLandmarkCount_NoCurbRamp");
//      $submittedLabelMessage = $("#LabeledLandmarks_SubmittedLabelCount");

//      self.labeledLandmark = {};
//      self.labeledLandmark.curbRamp = $labelCountCurbRamp;
//      self.labeledLandmark.noCurbRamp = $labelCountNoCurbRamp;
//      self.labeledLandmark.submitted = $submittedLabelMessage;
      self.counterHolder = $("#counter-holder");
      self.labelCounter = $("#label-counter");

      // Map DOMs
      self.map = {};
      self.map.canvas = $("canvas#labelCanvas");
      self.map.drawingLayer = $("div#labelDrawingLayer");
      self.map.pano = $("div#pano");
      self.map.streetViewHolder = $("div#streetViewHolder");
      self.map.viewControlLayer = $("div#viewControlLayer");
      self.map.modeSwitchWalk = $("span#modeSwitchWalk");
      self.map.modeSwitchDraw = $("span#modeSwitchDraw");
      self.googleMaps = {};
      self.googleMaps.holder = $("#google-maps-holder");
      self.googleMaps.holder.append('<div id="google-maps" class="google-maps-pane" style=""></div><div id="google-maps-overlay" class="google-maps-pane" style="z-index: 1"></div>')

      // MissionDescription DOMs
      self.statusMessage = {};
      self.statusMessage.holder = $("#current-status-holder");
      self.statusMessage.title = $("#current-status-title");
      self.statusMessage.description = $("#current-status-description");

      // OverlayMessage
      self.overlayMessage = {};
      self.overlayMessage.holder = $("#overlay-message-holder");
      self.overlayMessage.holder.append("<span id='overlay-message-box'><span id='overlay-message'>Walk</span></span>");
      self.overlayMessage.box = $("#overlay-message-box");
      self.overlayMessage.message = $("#overlay-message");

      // Pop up message
      self.popUpMessage = {};
      self.popUpMessage.holder = $("#pop-up-message-holder");
      self.popUpMessage.box = $("#pop-up-message-box");
      self.popUpMessage.background = $("#pop-up-message-background");
      self.popUpMessage.title = $("#pop-up-message-title");
      self.popUpMessage.content = $("#pop-up-message-content");

      // ProgressPov
      self.progressPov = {};
      self.progressPov.holder = $("#progress-pov-holder");
      self.progressPov.holder.append("<div id='progress-pov-label' class='bold'>Observed area:</div>");
      self.progressPov.holder.append("<div id='progress-pov-current-completion-bar'></div>");
      self.progressPov.holder.append("<div id='progress-pov-current-completion-bar-filler'></div>");
      self.progressPov.holder.append("<div id='progress-pov-current-completion-rate'>Hi</div>");
      self.progressPov.rate = $("#progress-pov-current-completion-rate");
      self.progressPov.bar = $("#progress-pov-current-completion-bar");
      self.progressPov.filler = $("#progress-pov-current-completion-bar-filler");

      // Ribbon menu DOMs
      $divStreetViewHolder = $("#Holder_StreetView");
      $ribbonButtonBottomLines = $(".RibbonModeSwitchHorizontalLine");
      $ribbonConnector = $("#StreetViewLabelRibbonConnection");
      $spansModeSwitches = $('span.modeSwitch');

      self.ribbonMenu = {};
      self.ribbonMenu.streetViewHolder = $divStreetViewHolder;
      self.ribbonMenu.buttons = $spansModeSwitches;
      self.ribbonMenu.bottonBottomBorders = $ribbonButtonBottomLines;
      self.ribbonMenu.connector = $ribbonConnector;

      // Zoom control
      self.zoomControl = {};
      self.zoomControl.holder = $("#zoom-control-holder");
      self.zoomControl.holder.append('<button id="zoom-in-button" class="button zoom-control-button"><img src="' + svl.rootDirectory + 'img/icons/ZoomIn.svg" class="zoom-button-icon" alt="Zoom in"><br />Zoom In</button>');
      self.zoomControl.holder.append('<button id="zoom-out-button" class="button zoom-control-button"><img src="' + svl.rootDirectory + 'img/icons/ZoomOut.svg" class="zoom-button-icon" alt="Zoom out"><br />Zoom Out</button>');
      self.zoomControl.zoomIn = $("#zoom-in-button");
      self.zoomControl.zoomOut = $("#zoom-out-button");

      // Form
      self.form = {};
      self.form.holder = $("#form-holder");
      self.form.commentField = $("#comment-field");
      self.form.skipButton = $("#skip-button");
      self.form.submitButton = $("#submit-button");

      self.onboarding = {};
      self.onboarding.holder = $("#onboarding-holder");
      if ("onboarding" in params && params.onboarding) {
        self.onboarding.holder.append("<div id='Holder_OnboardingCanvas'><canvas id='onboardingCanvas' width='720px' height='480px'></canvas><div id='Holder_OnboardingMessageBox'><div id='Holder_OnboardingMessage'></div></div></div>");
      }

    }

    _init(params);
    return self;
}

var svl = svl || {};

/**
 * User class constructor
 * @param $
 * @param param
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function User (param) {
    var self = {className: 'User'},
        properties = {};

    properties.username = param.username;

    self.getProperty = function (key) {
        return properties[key];
    };

    return self;
}

var svl = svl || {};

/**
 * Validator
 * @param param
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function Validator (param, $) {
    var oPublic = {
        'className' : 'Validator'
    };
    var properties = {
        onboarding: false
    };
    var status = {
        allLabelsHaveBeenValidated: false,
        disableAgreeButton: false,
        disableDisagreeButton: false,
        disableRadioButtons: false,
        menuBarMouseDown: false,
        radioCurrentLabelCheckState: 'ShowLabel',
        radioCurrentLabelHoverState: 'ShowLabel'
    };
    var mouse = {
        menuBarMouseDownX: undefined,
        menuBarMouseDownY: undefined,
        menuBarMouseUpX: undefined,
        menuBarMouseUpY: undefined,
        menuBarPrevX: undefined,
        menuBarPrevY: undefined
    };
    var currentLabel = undefined;
    var labels = [];

    var $divHolderValidation;
    var $divValidationMenuBar;
    var $divValidationDialogWindow;
    var $validationLabelMessage;
    var $btnAgree;
    var $btnDisagree;
    var $spansValidationCurrentLabeliVisibility;
    var $radioValidationCurrentLabelVisibility;
    var $spanNumCompletedTasks;
    var $spanNumTotalTasks;
    var $divProgressBarFiller;

    ////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////
    function currentLabelVisibilitySpanMousein (e) {
        // This is a mousein callback method for spans that hold ShowLabel/HideLabel radio buttons
        var $span = $(this);
        var radioValue = $span.attr("value"); // $span.find('input').attr('value');

        $span.css('background', 'rgba(230, 230, 230, 1)');
        status.radioCurrentLabelHoverState = radioValue;

        highlightCurrentLabel();
    }

    function currentLabelVisibilitySpanMouseout (e) {
        // This is a mouseout callback method for spans that hold ShowLabel/HideLabel radio buttons
        var $span = $(this);
        $span.css('background', 'transparent');
        status.radioCurrentLabelHoverState = 'ShowLabel';
        highlightCurrentLabel();
    }

    function currentLabelVisibilityRadioMousedown (e) {
        // This is a mousedown callback method for ShowLabel/HideLabel checkboxes.
        var radioValue = $(this).attr('value');
        status.radioCurrentLabelCheckState = radioValue;
        highlightCurrentLabel();
    }

    function getBoundingBox(povIn) {
        // This function takes
        var j;
        var len;
        var canvasCoords;
        var pov = povIn;
        var xMax = -1;
        var xMin = 1000000;
        var yMax = -1;
        var yMin = 1000000;

        // Check on points
        canvasCoords = getCanvasCoordinates(pov);
        len = canvasCoords.length;

        for (j = 0; j < len; j += 1) {
            var coord = canvasCoords[j];

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

        return {
            x: xMin,
            y: yMin,
            width: xMax - xMin,
            height: yMax - yMin
        };
    }

    function getCanvasCoordinates (pov, imCoords) {
        // Get canvas coordinates of points that constitute the label.
        // param imCoords: a list of image coordinates, i.e., [{x: xVal, y: yVal}, ...]
        // var imCoords = getImageCoordinates();
        var i;
        var len = imCoords.length;
        var canvasCoord;
        var canvasCoords = [];

        var min = 10000000;
        var max = -1;

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

    function getLabelBottom(label) {
        // This method gets the largest y-coordinate (i.e., closest to the bottom of the canvas) of label points
        //
        var i;
        var len = label.points.length;
        var pov = svl.getPOV();
//        {
//            heading: parseFloat(label.points[0].heading),
//            pitch: parseFloat(label.points[0].pitch),
//            zoom: parseFloat(label.points[0].zoom)
//        };

        // Format a label points.
        var point = undefined;
        var points = [];
        for (i = 0; i < len; i++) {
            point = {
                x: parseInt(label.points[i].svImageX),
                y: parseInt(label.points[i].svImageY)
            };
            points.push(point)
        }

        // Get the min
        var canvasCoordinates = getCanvasCoordinates(pov, points);

        var coord;
        var maxY = -1;
        for (i = 0; i < len; i++) {
            coord = canvasCoordinates[i];
            if (maxY < coord.y) {
                maxY = coord.y;
            }
        }
        return maxY;
    }

    function getLabelLeft(label) {
        // This method gets the smallest x-coordinate of label points
        //
        var i;
        var len = label.points.length;
        var pov = {
            heading: parseFloat(label.points[0].heading),
            pitch: parseFloat(label.points[0].pitch),
            zoom: parseFloat(label.points[0].zoom)
        };

        // Format a label points.
        var point = undefined;
        var points = [];
        for (i = 0; i < len; i++) {
            point = {
                x: parseInt(label.points[i].svImageX),
                y: parseInt(label.points[i].svImageY)
            };
            points.push(point)
        }

        // Get the min
        var canvasCoordinates = getCanvasCoordinates(pov, points);

        var coord;
        var minX = 1000000;
        for (i = 0; i < len; i++) {
            coord = canvasCoordinates[i];
            if (minX > coord.x) {
                minX = coord.x;
            }
        }
        return minX;
    }

    function getNextLabel () {
        // Get the next label that is not validated (i.e., label.validated == false)
        // This method returns false if all the labels have been validated.
        var i;
        var len = labels.length;
        var label;
        var allLabelsHaveBeenValidated = true;
        for (i = 0; i < len; i++) {
            label = labels[i];
            if (!label.validated) {
                allLabelsHaveBeenValidated = false;
                break;
            }
        }

        if (allLabelsHaveBeenValidated) {
            status.allLabelsHaveBeenValidated = allLabelsHaveBeenValidated;
            return false;
        } else {
            return label;
        }
    }

    function getNumTasksDone () {
        // Get number of tasks that are done.
        var i;
        var numTotalTasks = labels.length;
        var numTasksDone = 0;
        for (i = 0; i < numTotalTasks; i ++) {
            if (labels[i].validated) {
                numTasksDone += 1;
            }
        }
        return numTasksDone;
    }

    function hideDialogWindow () {
        // Hide the dialog box
        $divValidationDialogWindow.css('visibility', 'hidden');
    }

    function highlightCurrentLabel () {
        // Highlight the current label and dim the rest by changing the label properties
        if (!currentLabel) {
            throw oPublic.className + ': highlightCurrentLabel(): currentLabel is not set.';
        }
        var i;
        var j;
        var len;
        var canvasLabels;
        var canvasLabel;
        var canvasPath;
        var pathPoints;
        var pathPointsLen;

        if (svl.canvas) {
            var showLabel = undefined;
            canvasLabels = svl.canvas.getLabels();
            len = canvasLabels.length;

            // Decided whether currentLabel should be visible or not.
//            if (status.radioCurrentLabelHoverState) {
//                if (status.radioCurrentLabelHoverState === 'ShowLabel') {
//                    showLabel = true;
//                } else {
//                    showLabel = false;
//                }
//            } else {
//                if (status.radioCurrentLabelCheckState === 'ShowLabel') {
//                    showLabel = true;
//                } else {
//                    showLabel = false;
//                }
//            }
            if (status.radioCurrentLabelHoverState === 'ShowLabel') {
                showLabel = true;
            } else {
                showLabel = false;
            }

            for (i = 0; i < len; i ++) {
                canvasLabel = canvasLabels[i];
                canvasPath = canvasLabel.getPath(true); // Get a reference to the currentPath
                if (currentLabel.meta.labelId === canvasLabels[i].getProperty("labelId") &&
                    showLabel) {
                    // Highlight the label
                    // Change the fill and stroke color of a path to the original color (green and white)
                    // canvasPath.resetFillStyle();
                    // canvasPath.resetStrokeStyle();
                    canvasLabel.setVisibility('visible');

                    // Change the fill and stroke color of points to the original color
                    pathPoints = canvasPath.points;
                    pathPointsLen = pathPoints.length;
                    for (j = 0; j < pathPointsLen; j++) {
                        pathPoints[j].resetFillStyle();
                        pathPoints[j].resetStrokeStyle();
                    }
                } else {
                    // Dim the label
                    // Make fill and stroke of a path invisible
                    // canvasPath.setFillStyle('rgba(255,255,255,0)');
                    // canvasPath.setStrokeStyle('rgba(255,255,255,0)');
                    canvasLabel.setVisibility('hidden');

                    // Change the fill and stroke color of points invisible
                    pathPoints = canvasPath.points;
                    pathPointsLen = pathPoints.length;
                    for (j = 0; j < pathPointsLen; j++) {
                        pathPoints[j].setFillStyle('rgba(255,255,255,0)');
                        pathPoints[j].setStrokeStyle('rgba(255,255,255,0)');
                    }
                }

            }
            svl.canvas.clear();
            svl.canvas.render2();
        } else {
            throw oPublic.className + ': highlightCurrentLabel(): canvas is not defined.';
        }
    }

    function init(param) {
        properties.previewMode = param.previewMode;

        $divHolderValidation = $(param.domIds.holder);
        $divValidationDialogWindow = $("#ValidationDialogWindow");
        $divValidationMenuBar = $("#ValidationDialogWindowMenuBar");
        $validationLabelMessage = $("#ValidationLabelValue");
        $btnAgree = $("#ValidationButtonAgree");
        $btnDisagree =$("#ValidationButtonDisagree");
        $spansValidationCurrentLabeliVisibility = $(".SpanValidationCurrentLabeliVisibility");
        $radioValidationCurrentLabelVisibility = $(".RadioValidationCurrentLabelVisibility");

        $spanNumCompletedTasks = $("#NumCompletedTasks");
        $spanNumTotalTasks = $("#NumTotalTasks");
        $divProgressBarFiller = $("#ProgressBarFiller");

        // Attach listeners
        $divValidationMenuBar.on({
            mousedown: validationMenuBarMousedown,
            mouseleave: validationMenuBarMouseleave,
            mousemove: validationMenuBarMousemove,
            mouseup: validationMenuBarMouseup
        });

        $spansValidationCurrentLabeliVisibility.hover(currentLabelVisibilitySpanMousein, currentLabelVisibilitySpanMouseout);
        $radioValidationCurrentLabelVisibility.on('mousedown', currentLabelVisibilityRadioMousedown);

        $btnAgree.on('click', validationButtonAgreeClick);
        $btnDisagree.on('click', validationButtonDisagreeClick);

        hideDialogWindow();
        updateProgress();

        svl.ui.googleMaps.holder.css('visibility', 'hidden');
        // $("#google-maps-holder").css('visibility', 'hidden');
    }

    function showDialogWindow (timelapse) {
        // This method shows a dialog window to ask a user whether a current label is valid/invalid label.
        // If timelapse is specified, wait for timelapse milli-seconds to show the window.
        if (typeof(timelapse) !== "number") {
            console.error(oPublic.className, 'A parameter of showDialogWindow() should be in milli-seconds (number).');
            timelapse = undefined;
        }

        if (currentLabel) {
            var maxY = getLabelBottom(currentLabel); // Get the largest y-coordinate (i.e., closest to the bottom of the canvas) of label points
            var minX = getLabelLeft(currentLabel); // Get the smallest x-coordinate
            var message;

            if (currentLabel.meta.labelType === 'CurbRamp') {
                message = "We believe the green box (label) is correctly placed on a curb ramp in this image. Do you agree?";
                // message = 'We believe the <span class="bold">green box is placed on a curb ramp</span> in this image.';
            } else {
                message = 'We believe <span class="bold">there should be a curb ramp</span> under the highlighted area.';
            }
            $validationLabelMessage.html(message);
            // console.log(currentLabel.meta.labelType);

            if (timelapse) {
            // if (false) {
                setTimeout(function () {
                    // Recalculate. Hm, then the previous calculation is redundant.
                    maxY = getLabelBottom(currentLabel);
                    minX = getLabelLeft(currentLabel);
                    $divValidationDialogWindow.css({
                        left: minX,
                        top: maxY + 20,
                        visibility: 'visible'
                    });
                }, timelapse);

            } else {
                $divValidationDialogWindow.css({
                    left: minX,
                    top: maxY + 20,
                    visibility: 'visible'
                });
            }
        }
    }

    function updateProgress () {
        // This method updates the number of completed tasks and the progress bar in the interface.
        var numTotalTasks = labels.length;
        var numTasksDone = 0;
        numTasksDone = getNumTasksDone();

        $spanNumCompletedTasks.text(numTasksDone);
        $spanNumTotalTasks.text(numTotalTasks);

        var widthRatio = numTasksDone / numTotalTasks;
        var widthPercentage = parseInt(widthRatio * 100, 10) + '%'

        var r;
        var g;
        var rgbValue;
        if (widthRatio < 0.5) {
            r = 255;
            g = parseInt(255 * widthRatio * 2);
        } else {
            r = parseInt(255 * (1 - widthRatio) * 2);
            g = 255;
        }
        rgbValue = 'rgb(' + 4 + ',' + g + ', 0)';

        $divProgressBarFiller.css({
            background: rgbValue,
            width: widthPercentage
        });
    }

    function validationButtonAgreeClick () {
        // A callback function for click on an Agree button
        if (!currentLabel) {
            // if a current label is not set, set one.
            currentLabel = getNextLabel();
            if (!currentLabel) {
                // Todo. Navigate to submit validations
            }
        }
        currentLabel.validated = true;
        currentLabel.validationLabel = 'Agree';


        // svl.validatorForm.submit(); // Debug

        oPublic.validateNext();
        updateProgress();

        //
        // Return when everything is verified
        if (properties.onboarding) {
            return false;
        }
        if (getNumTasksDone() < labels.length) {
            return false;
        } else {
            if (properties.previewMode) {
                // Not a preview mode
                window.location.reload();
                return false;
            } else {
                // Return if it is not a preview mode.
                return true;
            }
        }
    }

    function validationButtonDisagreeClick () {
        // A callback function for click on a Disagree button
        if (!currentLabel) {
            // if a current label is not set, set one...
            currentLabel = getNextLabel();
            if (!currentLabel) {
                // Todo. Navigate to submit validations
            }
        }
        currentLabel.validated = true;
        currentLabel.validationLabel = 'Disagree';
        oPublic.validateNext();
        updateProgress();

        //
        // Return when everything is verified
        if (properties.onboarding) {
            return false;
        }
        if (getNumTasksDone() < labels.length) {
            return false;
        } else {
            if (properties.previewMode) {
                // Not a preview mode
                window.location.reload();
                return false;
            } else {
                // Return if it is not a preview mode.
                return true;
            }
        }
    }

    function validationMenuBarMousedown (e) {
        // A callback function for mousedown on a menu bar
        var m = mouseposition(e, 'body');

        status.menuBarMouseDown = true;
        mouse.menuBarPrevX = m.x;
        mouse.menuBarPrevY = m.y;
        mouse.menuBarMouseDownX = m.x;
        mouse.menuBarMouseDownY = m.y;
    }

    function validationMenuBarMouseleave (e) {
        // A callback function for mouseleave on a menu bar
        var m = mouseposition(e, 'body');

        status.menuBarMouseDown = false;
        mouse.menuBarMouseUpX = m.x;
        mouse.menuBarMouseUpY = m.y;
    }

    function validationMenuBarMousemove (e) {
        // A callback function for mousemove on a menu bar
        var m = mouseposition(e, 'body');
        if (status.menuBarMouseDown) {
            // Move around the validation dialog window if mouse is held down on the menu bar

            if (m && m.x && m.y && mouse.menuBarPrevX && mouse.menuBarPrevX) {
                var dx = m.x - mouse.menuBarPrevX;
                var dy = m.y - mouse.menuBarPrevY;

                // Get css top/left values as number
                // http://stackoverflow.com/questions/395163/get-css-top-value-as-number-not-as-string
                var currX = parseInt($divValidationDialogWindow.css('left'), 10);
                var currY = parseInt($divValidationDialogWindow.css('top'), 10);

                $divValidationDialogWindow.css({
                    left: currX + dx,
                    top: currY + dy
                });
            }
        }

        mouse.menuBarPrevX = m.x;
        mouse.menuBarPrevY = m.y;
    }

    function validationMenuBarMouseup (e) {
        // A callback function for mouseup on a menu bar
        var m = mouseposition(e, 'body');

        status.menuBarMouseDown = false;
        mouse.menuBarMouseUpX = m.x;
        mouse.menuBarMouseUpY = m.y;
    }

    ////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////
    oPublic.disableAgreeButton = function () {
        // This method disables the Agree button.
        status.disableAgreeButton = true;
        $btnAgree.css('opacity', '0.5');
        $btnAgree.attr('disabled', true);
        return this;
    };

    oPublic.disableDisagreeButton = function () {
        // This method disables the Disagree button.
        status.disableDisagreeButton = true;
        $btnDisagree.css('opacity', '0.5');
        $btnDisagree.attr('disabled', true);
        return this;
    };

    oPublic.disableRadioButtons = function () {
        // This method disables "Show label" and "Hide label" radio buttons
        status.disableRadioButtons = true;
        $radioValidationCurrentLabelVisibility.each(function (i, v) {
            $(v).attr('disabled', true);
        });
        return this;
    };

    oPublic.enableAgreeButton = function () {
        // This method enables the Agree button.
        status.disableAgreeButton = false;
        $btnAgree.css('opacity', '1');
        $btnAgree.attr('disabled', false);
        return this;
    };

    oPublic.enableDisagreeButton = function () {
        // This method enables the Disagree button.
        status.disableDisagreeButton = false;
        $btnDisagree.css('opacity', '1');
        $btnDisagree.attr('disabled', false);
    };

    oPublic.enableRadioButtons = function () {
        // This method enables "Show label" and "Hide label" radio buttons
        status.disableRadioButtons = false;
        $radioValidationCurrentLabelVisibility.each(function (i, v) {
            $(v).attr('disabled', false);
        });
        return;
    };

    oPublic.getLabels = function () {
        // This method returns validatorLabels
        return $.extend(true, [], labels);
    };

    oPublic.hideDialogWindow = function () {
        // This method hides a dialog window
        hideDialogWindow();
        return this;
    };

    oPublic.insertLabels = function (labelPoints) {
        // This method takes a label data (i.e., a set of point coordinates, label types, etc) and
        // and insert it into the labels array so the Canvas will render it
        var labelDescriptions = svl.misc.getLabelDescriptions();

        var param = {};
        param.canvasWidth = svl.canvasWidth;
        param.canvasHeight = svl.canvasHeight;
        param.canvasDistortionAlphaX = svl.alpha_x;
        param.canvasDistortionAlphaY = svl.alpha_y;
        param.labelId = labelPoints[0].LabelId;
        param.labelType = labelPoints[0].LabelType;
        param.labelDescription = labelDescriptions[param.labelType].text;
        param.panoId = labelPoints[0].LabelGSVPanoramaId;
        param.panoramaLat = labelPoints[0].Lat;
        param.panoramaLng = labelPoints[0].Lng;
        param.panoramaHeading = labelPoints[0].heading;
        param.panoramaPitch = labelPoints[0].pitch;
        param.panoramaZoom = labelPoints[0].zoom;
        param.svImageWidth = svl.svImageWidth;
        param.svImageHeight = svl.svImageHeight;
        param.svMode = 'html4';

        var label = {
            meta: param,
            points: labelPoints,
            validated: false,
            validationLabel: undefined
        };

        labels.push(label);

        updateProgress();
    };

    oPublic.setDialogWindowBorderWidth = function (width) {
        // This method sets the border width of the dialog window.
        $divValidationDialogWindow.css('border-width', width);
        return this;
    };

    oPublic.setDialogWindowBorderColor = function (color) {
        // This method sets the border color of the dialog window.
        $divValidationDialogWindow.css('border-color', color);
        return this;
    };

    oPublic.showDialogWindow = function (timelapse) {
        // This method shows a dialog window
        showDialogWindow(timelapse);
        return this;
    };

    oPublic.sortLabels = function () {
        // This method sorts the labels by it's heading angle.
        // Sorting an array of objects
        // http://stackoverflow.com/questions/1129216/sorting-objects-in-an-array-by-a-field-value-in-javascript
        function compare (a, b) {
            if (parseInt(a.points[0].svImageX) < parseInt(b.points[0].svImageX)) {
                return -1;
            }
            if (parseInt(a.points[0].svImageX) > parseInt(b.points[0].svImageX)) {
                return 1
            }
            return 0
        }

        labels.sort(compare);
        return this;
    };

    oPublic.validateNext = function (timelapse) {
        // This method changes the heading angle so the next unvalidated label will be centered
        // on the canvas.
        // 0. Wait and see whether panorama is ready
        // 1. Check if svl.map and svl.canvas exist
        // 2. Select the target label
        // 3. Adjust the SV heading angle and pitch angle so the target label will be centered.

        if (!('map' in svl)) {
            throw oPublic.className + ': Map is not defined.';
        }
        if (!('canvas' in svl)) {
            throw oPublic.className + ': Canvas is not defined.';
        }

        currentLabel = getNextLabel();
        if (currentLabel) {
            var pov = {
                heading: parseFloat(currentLabel.meta.panoramaHeading),
                pitch: parseFloat(currentLabel.meta.panoramaPitch),
                zoom: parseFloat(currentLabel.meta.zoom)
            };

            hideDialogWindow();

            if (typeof timelapse === "number" && timelapse >= 0) {
                var changePOVDuration = 500;
                svl.map.setPov(pov, changePOVDuration);
                highlightCurrentLabel();
                showDialogWindow(changePOVDuration);
            } else {
                svl.map.setPov(pov, 500);
                highlightCurrentLabel();
                showDialogWindow(500);
            }

        } else {
            // Todo. Navigate a user to submit
            hideDialogWindow();

            if (properties.onboarding) {
                return false;
            }
            svl.validatorForm.submit();
        }

        return this;
    };

    oPublic.setOnboarding = function (val) {
        properties.onboarding = val;
    };

    ////////////////////////////////////////
    // Initialize
    ////////////////////////////////////////
    init(param);

    return oPublic;
}

var svl = svl || {};

/**
 *
 * @param param
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ValidatorForm (param, $) {
    var oPublic = {className: 'ValidatorForm'};
    var properties = {
        dataStoreUrl: undefined,
        onboarding: undefined,
        taskDescription: undefined,
        taskPanoramaId: undefined,
        assignmentId: undefined,
        hitId: undefined,
        turkerId: undefined
    };
    var labelBinId = undefined;

    var $btnSubmit;

    ////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////
    function init (param) {
        for (attr in properties) {
            properties[attr] = param[attr];
        }
    }

    function submit () {
        // This method collects validation labels and submit the data to
        // the API specified by properties.submitURL.
        if (!('validator' in svl) || !svl.validator) {
            throw oPublic.className + ': Validator not defined.';
        }
        var taskGSVPanoId = properties.panoId;
        var url = properties.dataStoreUrl;
        var hitId;
        var assignmentId;
        var turkerId;
        var data = {};
        var i;
        var len;


        //
        hitId = properties.hitId ? properties.hitId : 'Test_Hit';
        assignmentId = properties.assignmentId? properties.assignmentId : 'Test_Assignment';
        turkerId = properties.turkerId ? properties.turkerId : 'Test_Kotaro';


        // Submit collected data if a user is not in oboarding mode.
        if (!properties.onboarding) {
            // if (true) {
            data.assignment = {
                amazon_turker_id : turkerId,
                amazon_hit_id : hitId,
                amazon_assignment_id : assignmentId,
                interface_type : 'StreetViewValidator',
                interface_version : '1',
                completed : 0,
                task_description : properties.taskDescription
            };

            data.labelBinId = labelBinId;
            data.validationTask = {
                task_panorama_id: properties.taskPanoramaId,
                task_gsv_panorama_id : taskGSVPanoId,
                description: ""
            };

            data.validationTaskEnvironment = {
                browser: getBrowser(),
                browser_version: getBrowserVersion(),
                browser_width: $(window).width(),
                browser_height: $(window).height(),
                screen_width: screen.width,
                screen_height: screen.height,
                avail_width: screen.availWidth,		// total width - interface (taskbar)
                avail_height: screen.availHeight,		// total height - interface };
                operating_system: getOperatingSystem()
            };

            //
            // Get interactions
            svl.tracker.push('TaskSubmit');
            data.userInteraction = svl.tracker.getActions();

            data.labels = [];

            // Format the validation labels
            var validatorLabels = svl.validator.getLabels();
            len = validatorLabels.length;
            for (i = 0; i < len; i++) {
                console.log(validatorLabels[i]);
                var temp = {};
                temp.labelId = validatorLabels[i].points[0].LabelId;
                temp.result = validatorLabels[i].validationLabel === "Disagree" ? 0 : 1;
                data.labels.push(temp);
            }

            // Add the value in the comment field if there are any.
//            var comment = $textieldComment.val();
//            data.comment = undefined;
//            if (comment &&
//                comment !== $textieldComment.attr('title')) {
//                data.comment = $textieldComment.val();
//            }

            // Submit data to
            try {
                $.ajax({
                    async: false,
                    url: url,
                    type: 'post',
                    data: data,
                    dataType: 'json',
                    success: function (result) {
                        if (result.error) {
                            throw result.error.message;
                        }
                    },
                    error: function (result) {
                        throw result;
                        // console.error(result);
                    }
                });
            } catch (e) {
                console.log(e);
            }



            if (properties.taskRemaining > 1) {
                window.location.reload();
            } else {
                if (properties.isAMTTask) {
                    $('input[name="assignmentId"]').attr('value', assignmentId);
                    $('input[name="workerId"]').attr('value', turkerId);
                    $('input[name="hitId"]').attr('value', hitId);
                    return true;
                } else {
                    window.location.reload();
                    //window.location = '/';
                    return false;
                }
            }

        }

        return false;
    }

    ////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////
    oPublic.setLabelBinId = function (binId) {
        labelBinId = binId;
        return this;
    };

    oPublic.submit = function () {
        return submit();
    };

    ////////////////////////////////////////
    // Initialize
    ////////////////////////////////////////
    init(param);
    return oPublic;
}

var svl = svl || {};

/**
 *
 * @param $ jQuery object
 * @param param Other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ZoomControl ($, param) {
    var self = {
        'className' : 'ZoomControl'
    };
    var properties = {
        maxZoomLevel: 3,
        minZoomLevel: 1
    };
    var status = {
        disableZoomIn: false,
        disableZoomOut: false
    };
    var lock = {
        disableZoomIn: false,
        disableZoomOut: false
    };
    var actionStack = [];

    // jQuery dom objects
    var $buttonZoomIn;
    var $buttonZoomOut;

    ////////////////////////////////////////
    // Private Functions
    ////////////////////////////////////////
    function _init (param) {
        // Initialization function

        //if ('domIds' in param) {
        if (svl.ui && svl.ui.zoomControl) {
          $buttonZoomIn = svl.ui.zoomControl.zoomIn;
          $buttonZoomOut = svl.ui.zoomControl.zoomOut;
          // $buttonZoomIn = ('zoomInButton' in param.domIds) ? $(param.domIds.zoomInButton) : undefined;
          // $buttonZoomOut = ('zoomOutButton' in param.domIds) ? $(param.domIds.zoomOutButton) : undefined;
        // }
        //
        //
        // // Attach listeners to buttons
        // if ($buttonZoomIn && $buttonZoomOut) {
          $buttonZoomIn.bind('click', buttonZoomInClick);
          $buttonZoomOut.bind('click', buttonZoomOutClick);
        }
    }


    function buttonZoomInClick () {
        // This is a callback function for zoom-in button. This function increments a sv zoom level.
        if ('tracker' in svl) {
          svl.tracker.push('Click_ZoomIn');
        }

        if (!status.disableZoomIn) {
            var pov = svl.panorama.getPov();
            setZoom(pov.zoom + 1);
            svl.canvas.clear().render2();
        }
    }

    function buttonZoomOutClick () {
        // This is a callback function for zoom-out button. This function decrements a sv zoom level.
        if ('traker' in svl) {
          svl.tracker.push('Click_ZoomOut');
        }

        if (!status.disableZoomOut) {
            var pov = svl.panorama.getPov();
            setZoom(pov.zoom - 1);
            svl.canvas.clear().render2();
        }
    }

    function pointZoomIn (x, y) {
        // This method takes a (x, y) canvas point and sets a zoom level.
        if (!status.disableZoomIn) {
            // Cancel drawing when zooming in or out.
            if ('canvas' in svl) {
              svl.canvas.cancelDrawing();
            }
            if ('panorama' in svl) {
                var currentPov = svl.panorama.getPov();
                var currentZoomLevel = currentPov.zoom;

                if (currentZoomLevel >= properties.maxZoomLevel) {
                    return false;
                }

                var width = svl.canvasWidth;
                var height = svl.canvasHeight;
                var minPitch = svl.map.getProperty('minPitch');
                var maxPitch = svl.map.getProperty('maxPitch');

                var zoomFactor = currentZoomLevel; // This needs to be fixed as it wouldn't work above level 3.
                var deltaHeading = (x - (width / 2)) / width * (90 / zoomFactor); // Ugh. Hard coding.
                var deltaPitch = - (y - (height / 2)) / height * (70 / zoomFactor); // Ugh. Hard coding.

                var pov = {};
                pov.zoom = currentZoomLevel + 1;
                pov.heading = currentPov.heading + deltaHeading;
                pov.pitch = currentPov.pitch + deltaPitch;

                //
                // Adjust the pitch angle.
                var maxPitch = svl.map.getMaxPitch();
                var minPitch = svl.map.getMinPitch();
                if (pov.pitch > maxPitch) {
                    pov.pitch = maxPitch;
                } else if (pov.pitch < minPitch) {
                    pov.pitch = minPitch;
                }

                //
                // Adjust the pitch so it won't exceed max/min pitch.
                svl.panorama.setPov(pov);
                return currentZoomLevel;
            } else {
                return false;
            }
        }
    }

    function setZoom (zoomLevelIn) {
        // This method sets the zoom level of the street view image.
        if (typeof zoomLevelIn !== "number") {
            return false;
        }

        // Cancel drawing when zooming in or out.
        if ('canvas' in svl) {
          svl.canvas.cancelDrawing();
        }

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

    ////////////////////////////////////////
    // Public Functions
    ////////////////////////////////////////
    /**
     * Disables zooming in
     * @method
     * @returns {self}
     */
    self.disableZoomIn = function () {
        // Enable zoom in.
        if (!lock.disableZoomIn) {
            status.disableZoomIn = true;
            if ($buttonZoomIn) {
                $buttonZoomIn.css('opacity', 0.5);
            }
        }
        return this;
    };

    self.disableZoomOut = function () {
        // Enable zoom out.
        if (!lock.disableZoomOut) {
            status.disableZoomOut = true;
            if ($buttonZoomOut) {
                $buttonZoomOut.css('opacity', 0.5);
            }
        }
        return this;
    };

    self.enableZoomIn = function () {
        // Enable zoom in.
        if (!lock.disableZoomIn) {
            status.disableZoomIn = false;
            if ($buttonZoomIn) {
                $buttonZoomIn.css('opacity', 1);
            }
        }
        return this;
    }

    self.enableZoomOut = function () {
        // Enable zoom out.
        if (!lock.disableZoomOut) {
            status.disableZoomOut = false;
            if ($buttonZoomOut) {
                $buttonZoomOut.css('opacity', 1);
            }
        }
        return this;
    };

    self.getLock = function (name) {
        if (name in lock) {
            return lock[name];
        } else {
            var errMsg = 'You cannot access a property "' + name + '".';
            throw errMsg;
        }
    };

    self.getStatus = function (name) {
        if (name in status) {
            return status[name];
        } else {
            var errMsg = 'You cannot access a property "' + name + '".';
            throw errMsg;
        }
    };

    self.getProperties = function (name) {
        if (name in properties) {
            return properties[name];
        } else {
            var errMsg = 'You cannot access a property "' + name + '".';
            throw errMsg;
        }
    };

    self.lockDisableZoomIn = function () {
        // Lock zoom in
        lock.disableZoomIn = true;
        return this;
    };

    self.lockDisableZoomOut = function () {
        // Lock zoom out.
        lock.disableZoomOut = true;
        return this;
    };

    self.updateOpacity = function () {
        var pov = svl.getPOV();

        if (pov) {
            var zoom = pov.zoom;
            //
            // Change opacity
            if (zoom >= properties.maxZoomLevel) {
                $buttonZoomIn.css('opacity', 0.5);
                $buttonZoomOut.css('opacity', 1);
            } else if (zoom <= properties.minZoomLevel) {
                $buttonZoomIn.css('opacity', 1);
                $buttonZoomOut.css('opacity', 0.5);
            } else {
                $buttonZoomIn.css('opacity', 1);
                $buttonZoomOut.css('opacity', 1);
            }
        }

        //
        // If zoom in and out are disabled, fade them out anyway.
        if (status.disableZoomIn) {
            $buttonZoomIn.css('opacity', 0.5);
        }
        if (status.disableZoomOut) {
            $buttonZoomOut.css('opacity', 0.5);
        }


        return this;
    };

    self.pointZoomIn = function (x, y) {
        // This function takes a canvas coordinate (x, y) and pass it to a private method pointZoomIn()
        if (!status.disableZoomIn) {
            return pointZoomIn(x, y);
        } else {
            return false;
        }
    };

    self.setMaxZoomLevel = function (zoomLevel) {
        // This method sets the maximum zoom level that SV can show.
        properties.maxZoomLevel = zoomLevel;
        return this;
    };

    self.setMinZoomLevel = function (zoomLevel) {
        // This method sets the minimum zoom level that SV can show.
        properties.minZoomLevel = zoomLevel;
        return this;
    };

    self.unlockDisableZoomIn = function () {
        // Lock zoom in
        lock.disableZoomIn = false;
        return this;
    };

    self.unlockDisableZoomOut = function () {
        // Lock zoom out.
        lock.disableZoomOut = false;
        return this;
    };

    self.zoomIn = function () {
        // This method is called from outside this object to zoom in to a GSV image.
        if (!status.disableZoomIn) {
            var pov = svl.panorama.getPov();
            setZoom(pov.zoom + 1);
            svl.canvas.clear().render2();
            return this;
        } else {
            return false;
        }
    };

    self.zoomOut = function () {
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
    };

    ////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////
    _init(param);

    return self;
};

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


//
// Object prototype
// http://www.smipple.net/snippet/insin/jQuery.fn.disableTextSelection
if (typeof Object.create !== 'function') {
    Object.create = function (o) {
        var F = function () {};
        F.prototype = o;
        return new F();
    };
}

//
// Trim function
// Based on a code on: http://stackoverflow.com/questions/498970/how-do-i-trim-a-string-in-javascript
if(typeof(String.prototype.trim) === "undefined")
{
    String.prototype.trim = function()
    {
        return String(this).replace(/^\s+|\s+$/g, '');
    };
}

//
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

//
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


////////////////////////////////////////////////////////////////////////////////
// Browser related functions
////////////////////////////////////////////////////////////////////////////////
//
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
        };
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


function getBusStopPositionLabel() {
    return {
        'NextToCurb' : {
            'id' : 'NextToCurb',
            'label' : 'Next to curb'
        },
        'AwayFromCurb' : {
            'id' : 'AwayFromCurb',
            'label' : 'Away from curb'
        },
        'None' : {
            'id' : 'None',
            'label' : 'Not provided'
        }
    }
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
        'StopSign' : {
            'id' : 'StopSign',
            'cursorImagePath' : 'public/img/cursors/Cursor_BusStop2.png'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'cursorImagePath' : 'public/img/cursors/Cursor_BusStop2.png'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'cursorImagePath' : 'public/img/cursors/Cursor_BusStop2.png'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'cursorImagePath' : 'public/img/cursors/Cursor_BusStop2.png'
        },
        'StopSign_None' : {
            'id' : 'StopSign_None',
            'cursorImagePath' : 'public/img/cursors/Cursor_BusStop2.png'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'cursorImagePath' : 'public/img/cursors/Cursor_BusStopShelter2.png'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'cursorImagePath' : 'public/img/cursors/Cursor_Bench2.png'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'cursorImagePath' : 'public/img/cursors/Cursor_TrashCan3.png'
        },
        'Landmark_MailboxAndNewsPaperBox' : {
            'id' : 'Landmark_MailboxAndNewsPaperBox',
            'cursorImagePath' : 'public/img/cursors/Cursor_Mailbox2.png'
        },
        'Landmark_OtherPole' : {
            'id' : 'Landmark_OtherPole',
            'cursorImagePath' : 'public/img/cursors/Cursor_OtherPole.png'
        }
    }
}


//
// Returns image paths corresponding to each label type.
//
function getLabelIconImagePath(labelType) {
    return {
        'Walk' : {
            'id' : 'Walk',
            'iconImagePath' : undefined
        },
        'StopSign' : {
            'id' : 'StopSign',
            'iconImagePath' : 'public/img/icons/Icon_BusStop.png'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'iconImagePath' : 'public/img/icons/Icon_BusStopSign_SingleLeg.png'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'iconImagePath' : 'public/img/icons/Icon_BusStopSign_TwoLegged.png'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'iconImagePath' : 'public/img/icons/Icon_BusStopSign_Column.png'
        },
        'StopSign_None' : {
            'id' : 'StopSign_None',
            'iconImagePath' : 'public/img/icons/Icon_BusStop.png'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'iconImagePath' : 'public/img/icons/Icon_BusStopShelter.png'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'iconImagePath' : 'public/img/icons/Icon_Bench.png'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'iconImagePath' : 'public/img/icons/Icon_TrashCan2.png'
        },
        'Landmark_MailboxAndNewsPaperBox' : {
            'id' : 'Landmark_MailboxAndNewsPaperBox',
            'iconImagePath' : 'public/img/icons/Icon_Mailbox2.png'
        },
        'Landmark_OtherPole' : {
            'id' : 'Landmark_OtherPole',
            'iconImagePath' : 'public/img/icons/Icon_OtherPoles.png'
        }
    }
}


//
// This function is used in OverlayMessageBox.js.
//
function getLabelInstructions () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'instructionalText' : 'Explore mode: Find the closest bus stop and label surrounding landmarks',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'StopSign' : {
            'id' : 'StopSign',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">stop sign</span>',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bus stop sign</span>',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'instructionalText' :'Label mode: Locate and click at the bottom of the <span class="underline">bus stop sign</span>',
            'textColor' :'rgba(255,255,255,1)'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bus stop sign</span>',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bus shelter</span>',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bench</span> nearby a bus stop',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">trash can</span> nearby a bus stop',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_MailboxAndNewsPaperBox' : {
            'id' : 'Landmark_MailboxAndNewsPaperBox',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">mailbox or news paper box</span> nearby a bus stop',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_OtherPole' : {
            'id' : 'Landmark_OtherPole',
            'instructionalText' : 'Label mode: Locate and click at the bottom of poles such as <span class="underline bold">traffic sign, traffic light, and light pole</span> nearby a bus stop',
            'textColor' : 'rgba(255,255,255,1)'
        }
    }
}

function getRibbonConnectionPositions () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'text' : 'Walk',
            'labelRibbonConnection' : '25px'
        },
        'StopSign' : {
            'id' : 'StopSign',
            'text' : 'Stop Sign',
            'labelRibbonConnection' : '112px'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'text' : 'One-leg Stop Sign',
            'labelRibbonConnection' : '112px'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'text' : 'Two-leg Stop Sign',
            'labelRibbonConnection' : '112px'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'text' : 'Column Stop Sign',
            'labelRibbonConnection' : '112px'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'text' : 'Bus Shelter',
            'labelRibbonConnection' : '188px'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'text' : 'Bench',
            'labelRibbonConnection' : '265px'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'text' : 'Trash Can',
            'labelRibbonConnection' : '338px'
        },
        'Landmark_MailboxAndNewsPaperBox' : {
            'id' : 'Landmark_MailboxAndNewsPaperBox',
            'labelRibbonConnection' : '411px'
        },
        'Landmark_OtherPole' : {
            'id' : 'Landmark_OtherPole',
            'labelRibbonConnection' : '484px'
        }
    }
}

// Colors selected from
// http://colorbrewer2.org/
// - Number of data classes: 4
// - The nature of data: Qualitative
// - Color scheme 1: Paired - (166, 206, 227), (31, 120, 180), (178, 223, 138), (51, 160, 44)
// - Color scheme 2: Set2 - (102, 194, 165), (252, 141, 98), (141, 160, 203), (231, 138, 195)
// I'm currently using Set 2
function getLabelDescriptions () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'text' : 'Walk'
        },
        'StopSign' : {
            'id' : 'StopSign',
            'text' : 'Bus Stop Sign'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'text' : 'One-leg Stop Sign'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'text' : 'Two-leg Stop Sign'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'text' : 'Column Stop Sign'
        },
        'StopSign_None' : {
            'id' : 'StopSign_None',
            'text' : 'Not provided'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'text' : 'Bus Stop Shelter'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'text' : 'Bench'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'text' : 'Trash Can / Recycle Can'
        },
        'Landmark_MailboxAndNewsPaperBox' : {
            'id' : 'Landmark_MailboxAndNewsPaperBox',
            'text' : 'Mailbox / News Paper Box'
        },
        'Landmark_OtherPole' : {
            'id' : 'Landmark_OtherPole',
            'text' : 'Traffic Sign / Pole'
        }
    }
}

function getLabelColors () {
    return colorScheme2();
}

function colorScheme1 () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
        },
        'StopSign' : {
            'id' : 'StopSign',
            'fillStyle' : 'rgba(102, 194, 165, 0.9)'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'fillStyle' : 'rgba(102, 194, 165, 0.9)'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'fillStyle' : 'rgba(102, 194, 165, 0.9)'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'fillStyle' : 'rgba(102, 194, 165, 0.9)'
        },
        'StopSign_None' : {
            'id' : 'StopSign_None',
            'fillStyle' : 'rgba(102, 194, 165, 0.9'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'fillStyle' : 'rgba(252, 141, 98, 0.9)'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'fillStyle' : 'rgba(141, 160, 203, 0.9)'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'fillStyle' : 'rgba(231, 138, 195, 0.9)'
        }
    }
}

//
// http://www.colourlovers.com/business/trends/branding/7880/Papeterie_Haute-Ville_Logo
function colorScheme2 () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
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

//
//http://www.colourlovers.com/fashion/trends/street-fashion/7896/Floral_Much
function colorScheme3 () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
        },
        'StopSign' : {
            'id' : 'StopSign',
            'fillStyle' : 'rgba(97, 210, 214, 0.9)'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'fillStyle' : 'rgba(97, 210, 214, 0.9)'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'fillStyle' : 'rgba(97, 210, 214, 0.9)'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'fillStyle' : 'rgba(97, 210, 214, 0.9)'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'fillStyle' : 'rgba(237, 20, 111, 0.9)'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'fillStyle' : 'rgba(237, 222, 69, 0.9)'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'fillStyle' : 'rgba(155, 240, 233, 0.9)'
        }
    }
}

//
// http://www.colourlovers.com/business/trends/branding/7884/Small_Garden_Logo
function colorScheme4 () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
        },
        'StopSign' : {
            'id' : 'StopSign',
            'fillStyle' : 'rgba(252, 217, 32, 0.9)'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'fillStyle' : 'rgba(252, 217, 32, 0.9)'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'fillStyle' : 'rgba(252, 217, 32, 0.9)'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'fillStyle' : 'rgba(252, 217, 32, 0.9)'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'fillStyle' : 'rgba(229, 59, 81, 0.9)'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'fillStyle' : 'rgba(60, 181, 181, 0.9)'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'fillStyle' : 'rgba(236, 108, 32, 0.9)'
        }
    }
}

//
// http://www.colourlovers.com/business/trends/branding/7874/ROBAROV_WEBDESIGN
function colorScheme5 () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
        },
        'StopSign' : {
            'id' : 'StopSign',
            'fillStyle' : 'rgba(208, 221, 43, 0.9)'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'fillStyle' : 'rgba(208, 221, 43, 0.9)'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'fillStyle' : 'rgba(208, 221, 43, 0.9)'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'fillStyle' : 'rgba(208, 221, 43, 0.9)'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'fillStyle' : 'rgba(152, 199, 61, 0.9)'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'fillStyle' : 'rgba(0, 169, 224, 0.9)'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'fillStyle' : 'rgba(103, 205, 220, 0.9)'
        }
    }
}

//
//http://www.colourlovers.com/print/trends/magazines/7834/Print_Design_Annual_2010
function colorScheme6 () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'fillStyle' : 'rgba(0, 0, 0, 0.9)'
        },
        'StopSign' : {
            'id' : 'StopSign',
            'fillStyle' : 'rgba(210, 54, 125, 0.9)'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'fillStyle' : 'rgba(210, 54, 125, 0.9)'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'fillStyle' : 'rgba(210, 54, 125, 0.9)'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'fillStyle' : 'rgba(210, 54, 125, 0.9)'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'fillStyle' : 'rgba(188, 160, 0, 0.9)'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'fillStyle' : 'rgba(207, 49, 4, 0.9)'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'fillStyle' : 'rgba(1, 142, 74, 0.9)'
        }
    }
}

var svl = svl || {};
svl.util = svl.util || {};
svl.util.color = {};

svl.util.color.RGBToRGBA = function (rgb, alpha) {
    if(!alpha){
        alpha = '0.5';
    }

    var newRGBA;
    if(rgb !== undefined) {
         newRGBA = 'rgba(';
         newRGBA+=rgb.substring(4,rgb.length-1)+','+alpha+')';
    }
    return newRGBA;
};

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
svl.util.color.changeAlphaRGBA = changeAlphaRGBA;

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
svl.util.color.changeDarknessRGBA = changeDarknessRGBA;

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
svl.util.color.rgbToHsl = rgbToHsl;

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
svl.util.color.hslToRgb = hslToRgb;

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
    //var radians = Array.prototype.map.call(arguments, function(deg) { return deg/180.0 * Math.PI; });
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
    return;
}
svl.util.shape.lineWithRoundHead = lineWithRoundHead;

/** @namespace */
var svl = svl || {};
svl.misc = {};

/**
 *
 * 0 for image y-axis is at *3328*! So the top-left corner of the image is (0, 3328).

 * Note: I realized I wrote a function in Point.js. (gsvImageCoordinate2CanvasCoordinate()).
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
svl.misc.imageCoordinateToCanvasCoordinate = imageCoordinateToCanvasCoordinate;

//self.svImageCoordinate.x = svImageWidth * pov.heading / 360 + (svl.alpha_x * (x - (svl.canvasWidth / 2)) / zoomFactor);
//self.svImageCoordinate.y = (svImageHeight / 2) * pov.pitch / 90 + (svl.alpha_y * (y - (svl.canvasHeight / 2)) / zoomFactor);


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
            cursorImagePath: svl.rootDirectory + 'img/cursors/pen.png'
        }
    }
}
svl.misc.getLabelCursorImagePath = getLabelCursorImagePath;


//
// Returns image paths corresponding to each label type.
//
function getLabelIconImagePath(labelType) {
    return {
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
            iconImagePath: null,
            googleMapsIconImagePath: svl.rootDirectory + '/img/icons/Sidewalk/GMapsStamp_Other.png'
        },
        Void: {
            id: 'Void',
            iconImagePath : null
        }
    }
}
svl.misc.getIconImagePaths = getLabelIconImagePath;


//
// This function is used in OverlayMessageBox.js.
//
function getLabelInstructions () {
    return {
        'Walk' : {
            'id' : 'Walk',
            'instructionalText' : 'Explore mode: Find and label curb ramps at this intersection.',
            'textColor' : 'rgba(255,255,255,1)'
        },
        CurbRamp: {
            id: 'CurbRamp',
            instructionalText: 'Label mode: Locate and draw an outline around the <span class="underline">curb ramp</span>',
            textColor: 'rgba(255,255,255,1)'
        },
        NoCurbRamp: {
            id: 'NoCurbRamp',
            instructionalText: 'Label mode: Locate and draw an outline around where a <span class="underline">curb ramp is missing</span>',
            textColor: 'rgba(255,255,255,1)'
        },
        Obstacle: {
          id: 'Obstacle',
          instructionalText: 'Label mode: Locate and draw an outline around a <span class="underline">obstacle in path</span>',
          textColor: 'rgba(255,255,255,1)'
        },
        Other: {
            id: 'Other',
            instructionalText: 'Label mode',
            textColor: 'rgba(255,255,255,1)'
        },
        SurfaceProblem: {
          id: 'SurfaceProblem',
          instructionalText: 'Label mode: Locate and draw an outline around a <span class="underline">sidewalk surface problem</span>',
          textColor: 'rgba(255,255,255,1)'
        },
        'StopSign' : {
            'id' : 'StopSign',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">stop sign</span>',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bus stop sign</span>',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'instructionalText' :'Label mode: Locate and click at the bottom of the <span class="underline">bus stop sign</span>',
            'textColor' :'rgba(255,255,255,1)'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bus stop sign</span>',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bus shelter</span>',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">bench</span> nearby a bus stop',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">trash can</span> nearby a bus stop',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_MailboxAndNewsPaperBox' : {
            'id' : 'Landmark_MailboxAndNewsPaperBox',
            'instructionalText' : 'Label mode: Locate and click at the bottom of the <span class="underline">mailbox or news paper box</span> nearby a bus stop',
            'textColor' : 'rgba(255,255,255,1)'
        },
        'Landmark_OtherPole' : {
            'id' : 'Landmark_OtherPole',
            'instructionalText' : 'Label mode: Locate and click at the bottom of poles such as <span class="underline bold">traffic sign, traffic light, and light pole</span> nearby a bus stop',
            'textColor' : 'rgba(255,255,255,1)'
        }
    }
}
svl.misc.getLabelInstructions = getLabelInstructions;

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
        'StopSign' : {
            'id' : 'StopSign',
            'text' : 'Stop Sign',
            'labelRibbonConnection' : '112px'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'text' : 'One-leg Stop Sign',
            'labelRibbonConnection' : '112px'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'text' : 'Two-leg Stop Sign',
            'labelRibbonConnection' : '112px'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'text' : 'Column Stop Sign',
            'labelRibbonConnection' : '112px'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'text' : 'Bus Shelter',
            'labelRibbonConnection' : '188px'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'text' : 'Bench',
            'labelRibbonConnection' : '265px'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'text' : 'Trash Can',
            'labelRibbonConnection' : '338px'
        },
        'Landmark_MailboxAndNewsPaperBox' : {
            'id' : 'Landmark_MailboxAndNewsPaperBox',
            'labelRibbonConnection' : '411px'
        },
        'Landmark_OtherPole' : {
            'id' : 'Landmark_OtherPole',
            'labelRibbonConnection' : '484px'
        }
    }
}

// Todo. Get rid of this global function.
function getLabelDescriptions () {
    return {
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
          text: 'Obstacle in a Path'
        },
        Other: {
            id: 'Other',
            text: 'Other'
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
        },
        'StopSign' : {
            'id' : 'StopSign',
            'text' : 'Bus Stop Sign'
        },
        'StopSign_OneLeg' : {
            'id' : 'StopSign_OneLeg',
            'text' : 'One-leg Stop Sign'
        },
        'StopSign_TwoLegs' : {
            'id' : 'StopSign_TwoLegs',
            'text' : 'Two-leg Stop Sign'
        },
        'StopSign_Column' : {
            'id' : 'StopSign_Column',
            'text' : 'Column Stop Sign'
        },
        'StopSign_None' : {
            'id' : 'StopSign_None',
            'text' : 'Not provided'
        },
        'Landmark_Shelter' : {
            'id' : 'Landmark_Shelter',
            'text' : 'Bus Stop Shelter'
        },
        'Landmark_Bench' : {
            'id' : 'Landmark_Bench',
            'text' : 'Bench'
        },
        'Landmark_TrashCan' : {
            'id' : 'Landmark_TrashCan',
            'text' : 'Trash Can / Recycle Can'
        },
        'Landmark_MailboxAndNewsPaperBox' : {
            'id' : 'Landmark_MailboxAndNewsPaperBox',
            'text' : 'Mailbox / News Paper Box'
        },
        'Landmark_OtherPole' : {
            'id' : 'Landmark_OtherPole',
            'text' : 'Traffic Sign / Pole'
        }
    }
}
svl.misc.getLabelDescriptions = getLabelDescriptions;

// Todo. Get rid of this global function.
function getLabelColors () {
    return SidewalkColorScheme2();
}
svl.misc.getLabelColors = getLabelColors;


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

function SidewalkColorScheme2 () {
    return {
        Walk : {
            id : 'Walk',
            fillStyle : 'rgba(0, 0, 0, 0.9)'
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
            fillStyle: 'rgba(241, 141, 5, 0.9)'
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

//
// http://www.colourlovers.com/business/trends/branding/7880/Papeterie_Haute-Ville_Logo
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
