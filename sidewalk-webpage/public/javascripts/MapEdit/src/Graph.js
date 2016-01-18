/**
 * An undirected graph.
 * Reference: https://github.com/chenglou/data-structures/blob/master/source/Graph.coffee
 * @constructor
 */
function Graph(_) {
    var _vertices = {},// This object is not necessary anymore...
        _edges = {},
        _vertexArray = [],
        _edgeArray = [],
        _uniqueVertexId = 0,
        _uniqueEdgeId = 0;

    /**
     * Add a vertex to this graph.
     * @param id
     * @param x
     * @param y
     */
    function addVertex(id, x, y) {
        if (!(id in _vertices)) {
            _vertices[id] = new Vertex(id, x, y);
            _vertexArray.push(_vertices[id]);
            return _vertices[id];
        }
    }

    /**
     * Add an edge that connects source and target.
     * @param id
     * @param sourceId
     * @param targetId
     */
    function addEdge(id, source, target) {
        if (!(id in _edges)) {
            _edges[id] = new Edge(id, source, target);
            _edgeArray.push(_edges[id]);
            _vertices[source.id].addEdge(_edges[id]);
            _vertices[target.id].addEdge(_edges[id]);
            return _edges[id];
        }
    }

    function getUniqueVertexId () {
        var keys = _.map(Object.keys(_vertices), function (x) { return parseInt(x, 10); });
        for (;;_uniqueVertexId++) {
            if (keys.indexOf(_uniqueVertexId) == -1) {
                break;
            }
        }

        return _uniqueVertexId;
    }

    function getUniqueEdgeId () {
        var keys = _.map(Object.keys(_edges), function (x) { return parseInt(x, 10); });
        for (;;_uniqueEdgeId++) {
            if (keys.indexOf(_uniqueEdgeId) == -1) {
                break;
            }
        }
        return _uniqueEdgeId;
    }

    /**
     * Get a vertex in the graph by id.
     * @param id
     * @returns {*}
     */
    function getVertex(id) {
        return _vertices[id];
    }

    /**
     * Get an edge in the graph by id.
     * @param id
     * @returns {*}
     */
    function getEdge(id) {
        return _edges[id];
    }

    /**
     * Remove a vertex
     * @param id
     */
    function removeVertex(id) {
        if (id in _vertices) {
            // Remove edges that are connected to this vertex
            var vertex = getVertex(id),
                edges = vertex.getEdges(),
                len = edges.length;
            for (var i = len - 1; i >= 0; i--) {
                removeEdge(edges[i].id);
            }

            // Remove the vertex
            var index = _vertexArray.indexOf(vertex);
            _vertexArray.splice(index, 1);
            delete _vertices[id];
        }
    }

    /**
     * Remove an edge
     * @param id
     */
    function removeEdge(id) {
        if (id in _edges) {
            // Remove the edge from the vertices that are connected to this edge
            var edge = getEdge(id);
            edge.source.removeEdge(id);
            edge.target.removeEdge(id);

            // Remove the edge
            var index = _edgeArray.indexOf(edge);
            _edgeArray.splice(index, 1);
            delete _edges[id];
        }
    }

    function setVertexCoordinate(id, x, y) {
        var vertex = getVertex(id);
        vertex.x = x;
        vertex.y = y;
    }


    function toString () {
        var concatenatedString = "";
        for (var i = 0; i < _vertexArray.length; i++) {
            concatenatedString += _vertices[i].lat + "," + _vertices[i].lng + "\n";
        }
        return concatenatedString;
    }

    return {
        vertices: _vertexArray,
        edges: _edgeArray,
        addVertex: addVertex,
        addEdge: addEdge,
        getUniqueVertexId: getUniqueVertexId,
        getUniqueEdgeId: getUniqueEdgeId,
        getVertex: getVertex,
        getEdge: getEdge,
        removeVertex: removeVertex,
        removeEdge: removeEdge,
        setVertexCoordinate: setVertexCoordinate,
        toString: toString
    };
}

function Vertex (id, lng, lat) {
    var _id = id,
        _edges = [],
        x = lng,
        y = lat,
        _lat = lat,
        _lng = lng;

    /**
     * Add an edgeId.
     * @param id
     */
    function addEdge (edge) {
        _edges.push(edge);
    }

    /**
     * Get an array of edgeIds that are connected to this vertex.
     * @returns {Array}
     */
    function getEdges () {
        return _edges;
    }

    /**
     * Remove an edgeId from the _edgeIds array.
     * @param id
     */
    function removeEdge(id) {
        var edgeIdArray = _edges.map(function (e) { return e.id; }),
            index = edgeIdArray.indexOf(id);
        if (index > -1) {
            _edges.splice(index, 1);
        }
    }

    return {
        x: x,
        y: y,
        lat: _lat,
        lng: _lng,
        id: _id,
        addEdge: addEdge,
        getEdges: getEdges,
        removeEdge: removeEdge
    };
}

function Edge (id, source, target) {
    var _id = id,
        _source = source,
        _target = target;
    return {
        id: _id,
        source: _source,
        target: _target
    };
}
