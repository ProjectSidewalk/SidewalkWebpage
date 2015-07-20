
        var wkx = require('wkx');
        var buffer = require('buffer');

        function bufferFromHex(hexData) {
            var ewkb = [];
            for(var idx = 0; idx < hexData.length; idx += 2) {
                ewkb.push(parseInt(hexData.slice(idx, idx + 2), 16));
            }
            return new buffer.Buffer(ewkb);
        }


        L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';
        // L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';



        // https://www.mapbox.com/guides/an-open-platform/#tilejson
        var tileJson = {
          "tiles": [ "https://api.tiles.mapbox.com/v4/mapbox.streets/{z}/{x}/{y}.png?access_token=pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA" ],
          "minzoom": 0,
          "maxzoom": 18
        };


        // Tile:
        // https://www.mapbox.com/developers/api/maps/#tilejson
        // var map = L.mapbox.map('map', 'mapbox.emerald')
        var map = L.mapbox.map('map', 'mapbox.streets-satellite')
            .setView([
                38.9047, -77.0164
                  ], 13);


        var tileLayer = L.tileLayer('https://{s}.tiles.mapbox.com/v3/{id}/{z}/{x}/{y}.png', {
          maxZoom: 20,
          attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, ' +
            '<a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, ' +
            'Imagery © <a href="http://mapbox.com">Mapbox</a>',
          id: 'examples.map-20v6611k'
        });

        tileLayer.addTo(map);

        L.control.layers({
            "Satellite": map.tileLayer,
            "Street": tileLayer
        }, null).addTo(map);


        // Styleing: http://leafletjs.com/examples/geojson.html
        // http://leafletjs.com/reference.html#path-dasharray
        // https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/stroke-dasharray
        var mystyle = {
          color: "#000",
          weight: 2,
          opacity: 0.75
        };
        function onEachFeature(feature, layer) {
          // does this feature have a property named popupContent?
            if (feature.properties && feature.properties.type) {
              // http://gis.stackexchange.com/questions/31951/how-to-show-a-popup-on-mouse-over-not-on-click
                layer.bindPopup(feature.properties.type);
                // layer.on('mouseover', function (e) {
                //   this.openPopup();
                // });
                // layer.on('mouseout', function (e) {
                //   this.closePopup();
                // });
            }
        }

        $.getJSON("/geom/json", function (data) {
            var len = data.length;
            var geojson = {};
            geojson.type = "FeatureCollection";
            geojson.features = [];
            for (var i = 0; i < len; i++) {
                var feature = {};

                // console.log("Data:", data[i]);
                var lineString = data[i].wkbGeometry;
                var buf = bufferFromHex(lineString);
                var parsed = wkx.Geometry.parse(buf);

                console.log("Parsed:", parsed);
                feature.type = "Feature";
                feature.id = data[i].id;
                feature.properties = {
                    'type': data[i].geomtype,
                    'id': data[i].id,
                    'user': data[i].user,
                    'stroke': data[i].stroke
                };
                feature.geometry = {
                    type: "LineString",
                    coordinates: []
                };
                for (var j = 0; j < parsed.points.length; j++) {
                    var point = parsed.points[j];
                    feature.geometry.coordinates.push([point.x, point.y]);
                }
                geojson.features.push(feature)
            }

           console.log(geojson);

          L.geoJson(geojson, {
            pointToLayer: L.mapbox.marker.style,
            style: function(feature) {
              // console.log(feature.properties.type);
              var tempStyle = $.extend(true, {}, mystyle);
              switch (feature.properties.type) {
                case "footway" :
                  tempStyle.color = "#333";
                  tempStyle.dashArray = "3, 2";
                  break;
                case "crosswalk":
                  tempStyle.color = "#888";
                  tempStyle.opacity = 0.25;
                  break;
                default:
                  tempStyle.color = "#333";
                  tempStyle.dashArray = "3, 2";
              }

              return tempStyle;
            },
            onEachFeature: onEachFeature
          })
          .addTo(map);

        });

