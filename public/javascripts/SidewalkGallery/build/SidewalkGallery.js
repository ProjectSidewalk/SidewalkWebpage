/**
 * A Card module.
 * @param params
 * @param imageUrl
 * @returns {Card}
 * @constructor
 */
function Card (params, imageUrl) {
    let self = this;

    let card = null;
    let validationMenu = null;

    // Properties of the label in the card
    let properties = {
        label_id: undefined,
        label_type: undefined,
        gsv_panorama_id: undefined,
        heading: undefined,
        pitch: undefined,
        zoom: undefined,
        canvas_x: undefined,
        canvas_y: undefined,
        canvas_width: undefined,
        canvas_height: undefined,
        severity: undefined,
        temporary: undefined,
        description: undefined,
        tags: []
    };

    let status = {
        visibility: 'hidden',
        imageFetched: false
    };

    let width = 360;

    let imageDim = {
        w:0,
        h:0
    }

    // Icon for label
    const labelIcon = new Image();

    // The static pano image
    const panoImage = new Image();

    function _init (param) {
        for (let attrName in param) {
            properties[attrName] = param[attrName];
        }

        let iconUrl = sg.util.properties.panorama.getIconImagePaths(getLabelType());
        labelIcon.src = iconUrl.iconImagePath;
        labelIcon.className = "label-icon";
        let iconCoords = getIconCoords();
        labelIcon.style.left = iconCoords.x + "px";
        labelIcon.style.top = iconCoords.y + "px";

        let imageId = "label_id_" + properties.label_id;
        panoImage.id = imageId;
        panoImage.className = "static-gallery-image";

        // Clean up ternary operators with constants?
        let severityHeader = properties.severity ? properties.severity : getLabelType() === "Occlusion" ? "not applicable" : "none";
        let tagHeader = properties.tags.length > 0 ? properties.tags.join(", ") : getLabelType() === "Occlusion" ? "not applicable" : "none";

        // TODO: Can we modularize this in some separate HTML
        //  file so we don't have to use template string?
        const cardHtml = `
            <p class="label-severity"><b>Severity:</b> ${severityHeader}</p>
            <p class="label-tags"><b>Tags:</b> ${tagHeader}</p>
        `;

        card = document.createElement('div');
        card.className = "gallery-card";
        card.innerHTML = cardHtml;

        card.prepend(panoImage);
        card.appendChild(labelIcon);

        validationMenu = new ValidationMenu(card, properties);
    }

    function getIconCoords () {
        return {
            x: imageDim.w * properties.canvas_x / properties.canvas_width,
            y: imageDim.h * properties.canvas_y / properties.canvas_height
        };
    }

    function updateWidth(w) {
        width = w;
        card.style.width = w + "px";

        imageDim.w = w - 10;
        imageDim.h = imageDim.w/(4/3);//1.333;        

        let iconCoords = getIconCoords();
        labelIcon.style.left = iconCoords.x + "px";
        labelIcon.style.top = iconCoords.y + "px";
    }

    /**
     * This function returns labelId property
     * @returns {string}
     */
    function getLabelId () {
        return properties.label_id;
    }

    /**
     * This function returns labelType property
     * @returns {*}
     */
    function getLabelType () {
        return properties.label_type;
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
     * Get status of tag
     */
    function getStatus() {
        return status;
    }

    /**
     * Loads the pano image from url
     */
    function loadImage() {
        return new Promise(resolve => {
            if (!status.imageFetched) {
                let img = panoImage;
                img.onload = () => {
                    status.imageFetched = true;
                    resolve(true);
                    //cardContainer.append(card);
                };
    
                img.src = imageUrl;
            } else {
                resolve(true);
            }
        });
    }

    /**
     * This method renders the card
     * @param cardContainer
     * @returns {self}
     */
    function render (cardContainer) {
        // TODO: should there be a safety check here to make sure pano is loaded?
        panoImage.width = imageDim.w;
        panoImage.height = imageDim.h;
        cardContainer.append(card);

        // TODO: what is this for?
        setStatus("visibility", "visible");
        //card.visiblility = status.visibility;
    }

    /**
     * 
     * render with an overload that allows you to set the width and height of the
     * card
     */
    function renderSize(cardContainer, width) {
        updateWidth(width);
        render(cardContainer);
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
     * Set status of tag
     */
    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    self.getLabelId = getLabelId;
    self.getLabelType = getLabelType;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.getStatus = getStatus;
    self.loadImage = loadImage;
    self.render = render;
    self.renderSize = renderSize;
    self.setProperty = setProperty;
    self.setStatus = setStatus;

    _init(params);
    return this;
}
/**
 * A Card Bucket to store Cards of a certain label type
 * @param bucket object containing cards categorized by severity
 * @returns {TagBucket}
 * @constructor
 */
function CardBucket(bucket, size) {
    let self = this;

    bucket = bucket || [];

    function push(card) {
        bucket.push(card);
    }

    /**
     * Filters cards upon a non-empty array of tags
     * 
     * @param {*} tags tags to filter upon
     */
    function filterOnTags(tags) {
        if (tags.length > 0) {
            let tagSet = new Set(tags);
            bucket = bucket.filter(card => card.getProperty("tags").some(tag => tagSet.has(tag)));
        }
    }

    /**
     * Filters cards upon a non-empty array of severities
     * 
     * @param {*} severities severities to filter upon
     */
    function filterOnSeverities(severities) {
        if (severities.length > 0) {
            let severitySet = new Set(severities);
            bucket = bucket.filter(card => severitySet.has(card.getProperty("severity")));
        }
    }

    function getCards() {
        return bucket;
    }

    function getSize() {
        return bucket.length;
    }

    function copy() {
        return new CardBucket([...bucket]);
    }

    self.push = push;
    self.filterOnTags = filterOnTags;
    self.filterOnSeverities = filterOnSeverities;
    self.getCards = getCards;
    self.getSize = getSize;
    self.copy = copy;

    return this;
}
/**
 * Card Container module. This is responsible for managing the Card objects that are to be rendered.
 * @returns {CardContainer}
 * @constructor
 */
function CardContainer(uiCardContainer) {
    let self = this;

    const cardsPerPage = 9;

    const cardPadding = 25;

    let status = {
        order: 0
    };

    let labelTypeIds = {
        CurbRamp: 1,
        NoCurbRamp: 2,
        Obstacle: 3,
        SurfaceProblem: 4,
        Other: 5,
        Occlusion: 6,
        NoSidewalk: 7,
        Assorted: 9
    };

    let currentLabelType = 'Assorted';

    let currentPage = 1;

    let pageNumberDisplay = null;

    let pagewidth;

    //const cardPadding = 15;

    let cardsByType = {
        Assorted: null,
        CurbRamp: null,
        NoCurbRamp: null,
        Obstacle: null,
        SurfaceProblem: null,
        Other: null,
        Occlusion: null,
        NoSidewalk: null
    };

    // Keep track of labels we have loaded already as to not grab the same label from the backend
    let loadedLabelIds = new Set();

    // Current labels being displayed of current type based off filters
    let currentCards = new CardBucket();

    function _init() {
        pagewidth = uiCardContainer.holder.width();
        if (uiCardContainer) {
            uiCardContainer.nextPage.bind({
                click: handleNextPageClick
            })
            uiCardContainer.prevPage.bind({
                click: handlePrevPageClick
            })
        }

        pageNumberDisplay = document.createElement('h2');
        pageNumberDisplay.innerText = "1";
        uiCardContainer.pageNumber.append(pageNumberDisplay);
        cardsByType[currentLabelType] = new CardBucket();
        fetchLabelsByType(9, 30, Array.from(loadedLabelIds), function() {
            render();
        });
    }

    function handleNextPageClick() {
        sg.tracker.push("NextPageClick", null, {
            From: currentPage,
            To: currentPage + 1
        });
        setPage(currentPage + 1);
        updateCardsNewPage();
    }

    function handlePrevPageClick() {
        if (currentPage > 1) {
            sg.tracker.push("PrevPageClick", null, {
                From: currentPage,
                To: currentPage - 1
            });
            setPage(currentPage - 1);
            updateCardsNewPage();
        }
    }

    function setPage(pageNumber) {
        currentPage = pageNumber;
        pageNumberDisplay.innerText = pageNumber;
    }

    function fetchLabelsByType(labelTypeId, n, loadedLabels, callback) {
        $.getJSON("/label/labelsByType", { labelTypeId: labelTypeId, n: n, loadedLabels: JSON.stringify(loadedLabels)}, function (data) {
            if ("labelsOfType" in data) {
                let labels = data.labelsOfType,
                    card,
                    i = 0,
                    len = labels.length;
                for (; i < len; i++) {
                    let labelProp = labels[i];
                    if ("label" in labelProp && "imageUrl" in labelProp) {
                        card = new Card(labelProp.label, labelProp.imageUrl);
                        self.push(card);
                        loadedLabelIds.add(card.getLabelId());
                    }
                }
                currentCards = cardsByType[currentLabelType].copy();
                if (callback) callback();
            }
        });
        
    }

    function fetchLabelsBySeverityAndTags(labelTypeId, n, loadedLabels, severities, tags, callback) {
        $.getJSON("/label/labelsBySeveritiesAndTags", { labelTypeId: labelTypeId, n: n, loadedLabels: JSON.stringify(loadedLabels), severities: JSON.stringify(severities), tags: JSON.stringify(tags) }, function (data) {
            if ("labelsOfType" in data) {
                let labels = data.labelsOfType,
                    card,
                    i = 0,
                    len = labels.length;
                for (; i < len; i++) {
                    let labelProp = labels[i];
                    if ("label" in labelProp && "imageUrl" in labelProp) {
                        card = new Card(labelProp.label, labelProp.imageUrl);
                        self.push(card)
                        loadedLabelIds.add(card.getLabelId());
                    }
                }
                if (callback) callback();
            }
        });

    }

    /**
     * Returns cards of current type
     */
    function getCards() {
        return cardsByType;
    }

    /**
     * Returns cards of current type that are being rendered
     */
    function getCurrentCards() {
        return currentCards;
    }

    /**
     * Push a card into cardsOfType
     * @param card
     */
    function push(card) {
        if (currentLabelType == 'Assorted') {
            // TODO: Can we cache cards pulled in the "assorted" bucket into their resepctive card buckets?
            cardsByType[currentLabelType].push(card);
        } else {
            cardsByType[card.getLabelType()].push(card);
        }
    }

    /**
     * Updates cardsOfType if card type changes, and currentCards if filter changes
     */
    function updateCardsByType() {
        refreshUI();

        let filterLabelType = sg.tagContainer.getStatus().currentLabelType;
        if (currentLabelType !== filterLabelType) {
            // reset back to the first page
            setPage(1);
            sg.tagContainer.unapplyTags(currentLabelType)
            currentLabelType = filterLabelType;

            if (cardsByType[currentLabelType] == null) {
                cardsByType[currentLabelType] = new CardBucket();
                fetchLabelsByType(labelTypeIds[filterLabelType], 30, Array.from(loadedLabelIds), function () {
                    render();
                });
            } else {
                currentCards = cardsByType[currentLabelType].copy();
                render();
            }
        }
    }

    function updateCardsNewPage() {
        // TODO: fix
        refreshUI();

        let appliedTags = sg.tagContainer.getAppliedTagNames();
        appliedTags = appliedTags.length > 0 ? appliedTags : sg.tagContainer.getTagNames();

        let appliedSeverities = sg.tagContainer.getAppliedSeverities();
        // TODO: figure out how to make a default severity set to grab all severities (including null)
        appliedSeverities = appliedSeverities = appliedSeverities.length > 0 ? appliedSeverities : [1, 2, 3, 4, 5];

        currentCards = cardsByType[currentLabelType].copy();
        currentCards.filterOnTags(appliedTags);
        currentCards.filterOnSeverities(appliedSeverities);

        if (currentCards.getSize() < cardsPerPage * currentPage) {
            if (currentLabelType === "Occlusion") {
                fetchLabelsByType(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), function () {
                    render();
                });
            } else {
                fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), appliedSeverities, appliedTags, function() {
                    currentCards = cardsByType[currentLabelType].copy();
                    currentCards.filterOnTags(appliedTags);
                    currentCards.filterOnSeverities(appliedSeverities);
        
                    render();
                });
            }
        } else {
            render();
        }
    }

    function updateCardsByTag() {
        setPage(1);
        refreshUI();

        let appliedTags = sg.tagContainer.getAppliedTagNames();
        appliedTags = appliedTags.length > 0 ? appliedTags : sg.tagContainer.getTagNames();

        let appliedSeverities = sg.tagContainer.getAppliedSeverities();
        // TODO: figure out how to make a default severity set to grab all severities (including null)
        appliedSeverities = appliedSeverities = appliedSeverities.length > 0 ? appliedSeverities : [1, 2, 3, 4, 5];

        fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), appliedSeverities, appliedTags, function() {
            currentCards = cardsByType[currentLabelType].copy();
            currentCards.filterOnTags(appliedTags);
            currentCards.filterOnSeverities(appliedSeverities);

            render();
        });
    }

    function updateCardsBySeverity() {
        setPage(1);
        refreshUI();

        let appliedTags = sg.tagContainer.getAppliedTagNames();
        appliedTags = appliedTags.length > 0 ? appliedTags : sg.tagContainer.getTagNames();

        let appliedSeverities = sg.tagContainer.getAppliedSeverities();
        // TODO: figure out how to make a default severity set to grab all severities (including null)
        appliedSeverities = appliedSeverities = appliedSeverities.length > 0 ? appliedSeverities : [1, 2, 3, 4, 5];

        fetchLabelsBySeverityAndTags(labelTypeIds[currentLabelType], cardsPerPage, Array.from(loadedLabelIds), appliedSeverities, appliedTags, function() {
            currentCards = cardsByType[currentLabelType].copy();
            currentCards.filterOnTags(appliedTags);
            currentCards.filterOnSeverities(appliedSeverities);

            render();
        });
    }

    function sortCards(order) {
        // uiCardContainer.holder.empty();
        // currentCards.sort((card1, card2) => sg.cardSortMenu.getStatus().severity * card1.getProperty("severity") - card2.getProperty("severity"));
        //
        // render();
        // console.log("sort cards in card container called");
        // // Write a sorting query for backend
        // setStatus("order", order);
        // render();
    }

    /**
     * Renders current cards
     */
    function render() {
        $("#page-loading").show();
        // https://stackoverflow.com/questions/11071314/javascript-execute-after-all-images-have-loaded
        // ^^^
        // Useful link for loading then showing all iamges at once rather than weird card "shells"
         
        // TODO: should we try to just empty in the render method? Or assume it's 
        // already been emptied in a method utilizing render?
        uiCardContainer.holder.empty();
        pagewidth = uiCardContainer.holder.width();
        const cardWidth = pagewidth/3 - cardPadding;

        //TODO: refactor render method to handle going through currentCard CardBucket and rendering those of selected severities
        let idx = (currentPage - 1) * cardsPerPage;
        let cardBucket = currentCards.getCards();

        let imagesToLoad = [];
        let imagePromises = [];

        while (idx < currentPage * cardsPerPage && idx < cardBucket.length) {
            imagesToLoad.push(cardBucket[idx]);
            imagePromises.push(cardBucket[idx].loadImage());

            idx++;
        }

        // for (let i = severities.length - 1; i >= 0; i--) {
        //     if (severities[i].getActive() || noSeverities) {
        //         let subBucket = cardBucket[severities[i].getSeverity()];
        //         for (let j = 0; j < subBucket.length; j++) {
        //             if (num >= cardsPerPage * currentPage) break;
        //             if (num >= start) {
        //                 imagesToLoad.push(subBucket[j]);
        //                 imagePromises.push(subBucket[j].loadImage());
        //             }

        //             num++;
        //         }
        //     }
        // }

        if (imagesToLoad.length > 0) {
            Promise.all(imagePromises).then(() => {
                imagesToLoad.forEach(card => card.renderSize(uiCardContainer.holder, cardWidth));
                $("#page-loading").hide();
            });
        } else {
            // TODO: figure out how to better do the toggling of this element
            $("#labels-not-found").show();
            $("#page-loading").hide();
        }
        // We can put a call to start the loading gif here and end the gif in the 'then' statement of the promise
    }

    function refreshUI() {
        $("#labels-not-found").hide();
        $("#page-loading").show();
        uiCardContainer.holder.empty();
    }

    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    /**
     * Flush all cards currently being rendered
     */
    function clearCurrentCards() {
        currentCards = new CardBucket();
    }

    /**
     * Flush all cards from cardsOfType
     */
    function clearCards() {
        for (let labelType in cardsByType) {
            cardsByType[labelType] = null;
        }
    }

    self.fetchLabelsByType = fetchLabelsByType;
    self.getCards = getCards;
    self.getCurrentCards = getCurrentCards;
    self.push = push;
    self.updateCardsByType = updateCardsByType;
    self.updateCardsByTag = updateCardsByTag;
    self.updateCardsBySeverity = updateCardsBySeverity;
    self.updateCardsNewPage = updateCardsNewPage;
    self.sortCards = sortCards;
    self.render = render;
    self.clearCurrentCards = clearCurrentCards;
    self.clearCards = clearCards;

    _init();
    return this;
}
/**
 * Compiles and submits log data from Sidewalk Gallery
 * 
 * @param {*} url 
 * @param {*} beaconUrl 
 * @returns {Form}
 * @constructor
 */
function Form(url, beaconUrl) {
    let properties = {
        dataStoreUrl : url,
        beaconDataStoreUrl : beaconUrl
    };

    /**
     * Compiles data into a format that can be parsed by our backend.
     * @returns {{}}
     */
    function compileSubmissionData() {
        let data = {};

        // let labelContainer = svv.labelContainer;
        // let labelList = labelContainer ? labelContainer.getCurrentLabels() : null;

        // TODO: figure out how to make/what to include in Gallery environment table
        //console.log("language: " + i18next.language);
        data.environment = {
            browser: util.getBrowser(),
            browser_version: util.getBrowserVersion(),
            browser_width: $(window).width(),
            browser_height: $(window).height(),
            screen_width: screen.width,
            screen_height: screen.height,
            avail_width: screen.availWidth,              // total width - interface (taskbar)
            avail_height: screen.availHeight,            // total height - interface };
            operating_system: util.getOperatingSystem(),
            language: i18next.language
        };

        data.interactions = sg.tracker.getActions();
        sg.tracker.refresh();
        return data;
    }

    /**
     * Submits all front-end data to the backend.
     * @param data  Data object (containing Interactions, Missions, etc...)
     * @param async
     * @returns {*}
     */
    function submit(data, async) {
        if (typeof async === "undefined") {
            async = false;
        }

        if (data.constructor !== Array) {
            data = [data];
        }

        $.ajax({
            async: async,
            contentType: 'application/json; charset=utf-8',
            url: properties.dataStoreUrl,
            type: 'post',
            data: JSON.stringify(data),
            success: function () {
                console.log("Data logged successfully");
            },
            error: function (xhr, status, result) {
                console.error(xhr.responseText);
                console.error(result);
            }
        });
    }

    // TODO: figure out how beacon datastore works
    $(window).on('beforeunload', function () {
        sg.tracker.push("Unload");

        // April 17, 2019
        // What we want here is type: 'application/json'. Can't do that quite yet because the
        // feature has been disabled, but we should switch back when we can.
        //
        // // For now, we send plaintext and the server converts it to actual JSON
        //
        // Source for fix and ongoing discussion is here:
        // https://bugs.chromium.org/p/chromium/issues/detail?id=490015
        let data = [compileSubmissionData()];
        let jsonData = JSON.stringify(data);
        navigator.sendBeacon(properties.beaconDataStoreUrl, jsonData);
    });

    self.compileSubmissionData = compileSubmissionData;
    self.submit = submit;

    return self;
}

/**
 * Logs information from the Sidewalk Gallery
 * @returns {Tracker}
 * @constructor
 */
function Tracker() {
    let self = this;
    let actions = [];

    function _init() {
        //_trackWindowEvents();
    }

    // TODO: update/include for v1.1
    function _trackWindowEvents() {
        let prefix = "LowLevelEvent_";

        // track all mouse related events
        $(document).on('mousedown mouseup mouseover mouseout mousemove click contextmenu dblclick', function(e) {
            self.push(prefix + e.type, {
                cursorX: 'pageX' in e ? e.pageX : null,
                cursorY: 'pageY' in e ? e.pageY : null
            });
        });

        // keyboard related events
        $(document).on('keydown keyup', function(e) {
            self.push(prefix + e.type, {
                keyCode: 'keyCode' in e ? e.keyCode : null
            });
        });
    }

    /**
     * Creates action to be added to action buffer
     * 
     * @param action
     * @param notes
     * @param extraData
     * @private
     */
    function _createAction(action, suppData, notes) {
        if (!notes) {
            notes = {};
        }

        let note = _notesToString(notes);
        let timestamp = new Date().getTime();

        let data = {
            action: action,
            pano_id: suppData && suppData.panoId ? suppData.panoId : null,
            note: note,
            timestamp: timestamp
        };

        return data;
    }

    function getActions() {
        return actions;
    }

    function _notesToString(notes) {
        if (!notes)
            return "";

        let noteString = "";
        for (let key in notes) {
            if (noteString.length > 0)
                noteString += ",";
            noteString += key + ':' + notes[key];
        }

        return noteString;
    }

    /**
     * Pushes information to action list (to be submitted to the database)
     * @param action    (required) Action
     * @param notes     (optional) Notes to be logged into the notes field database
     * @param extraData (optional) Extra data that should not be stored in the db notes field
     */
    function push(action, suppData, notes) {
        let item = _createAction(action, suppData, notes);
        actions.push(item);

        // TODO: change action buffer size limit
        if (actions.length > 2) {
            let data = sg.form.compileSubmissionData();
            sg.form.submit(data, true);
        }
        return this;
    }

    /**
     * Empties actions stored in the Tracker.
     */
    function refresh() {
        actions = [];
        self.push("RefreshTracker");
    }

    _init();

    self.getActions = getActions;
    self.push = push;
    self.refresh = refresh;

    return this;
}
/**
 * Card Filter module. This is responsible for allowing users to apply
 * filters to specify what types of cards to render in the gallery
 *
 * @returns {CardFilter}
 * @constructor
 */
function CardFilter(uiCardFilter, ribbonMenu) {
    let self = this;

    let status = {
        currentLabelType: 'Assorted'
    };

    let tagsByType = {
        Assorted: new TagBucket(),
        CurbRamp: new TagBucket(),
        NoCurbRamp: new TagBucket(),
        Obstacle: new TagBucket(),
        SurfaceProblem: new TagBucket(),
        Other: new TagBucket(),
        Occlusion: new TagBucket(),
        NoSidewalk: new TagBucket()
    };

    let currentTags = new TagBucket();

    let severities = new SeverityBucket();
   
    function _init() {
        getTags(function () {
            console.log("tags received");
            render();
        });
    }

    function getTags(callback) {
        $.getJSON("/label/tags", function (data) {
            let tag,
                i = 0,
                len = data.length;
            for (; i < len; i++) {
                tag = new Tag(data[i]);
                tagsByType[tag.getLabelType()].push(tag);
            }

            if (callback) callback();
        });
    }

    function update() {
        let currentLabelType = ribbonMenu.getCurrentLabelType();
        if (status.currentLabelType !== currentLabelType) {
            clearCurrentTags();
            severities.unapplySeverities();
            setStatus('currentLabelType', currentLabelType);
            currentTags = tagsByType[currentLabelType];
            sg.cardContainer.updateCardsByType();
        }

        render();
    }

    function render() {
        if (currentTags.getTags().length > 0) {
            // TODO: think about to better show tags header in an organized manner
            $("#tags-header").show();
            currentTags.render(uiCardFilter.tags);
        } else {
            $("#tags-header").hide();
        }

        severities.render(uiCardFilter.severity);
    }

    function getAppliedTagNames() {
        return currentTags.getAppliedTags().map(tag => tag.getTag());
    }

    function getTagNames() {
        return currentTags.getTags().map(tag => tag.getTag());
    }

    function getTagsByType() {
        return tagsByType;
    }

    function getStatus() {
        return status;
    }

    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    function getSeverities() {
        //return severities;
        return severities.getSeverities();
    }

    function isSeverityApplied() {
        // for (let i = 0; i < severities.length; i++){
        //     if (severities[i].getActive()) {
        //         return true;
        //     }
        // }
        // return false;
        return severities.isSeverityApplied();
    }

    function getAppliedSeverities() {
        return severities.getAppliedSeverities();
    }

    function unapplyTags(labelType) {
        if (labelType != null) {
            console.log("tags unapplied");
            console.log(labelType);
            tagsByType[labelType].unapplyTags();
        }
    }

    function clearCurrentTags() {
        uiCardFilter.tags.empty();
        unapplyTags(status.currentLabelType);
        currentTags = new TagBucket();
    }

    self.update = update;
    self.render = render;
    self.getAppliedTagNames = getAppliedTagNames;
    self.getTagNames = getTagNames;
    self.getTagsByType = getTagsByType;
    self.getStatus = getStatus;
    self.setStatus = setStatus;
    self.getSeverities = getSeverities;
    self.isSeverityApplied = isSeverityApplied;
    self.getAppliedSeverities = getAppliedSeverities;
    self.unapplyTags = unapplyTags;

    _init();
    return this;
}
// class CardSortMenu {
//     constructor(uiCardSortMenu) {
//         this.uiCardSortMenu = uiCardSortMenu;
//
//         // TODO: Right now, to do ordering, we use negative/positive sign flipping. Can we convert this to something nicer?
//         this._status = {
//             severity: 1
//         };
//
//         let self = this;
//
//         if (this.uiCardSortMenu) {
//             this.uiCardSortMenu.switches.bind({
//                 click: this.handleSortSwitchClickCallback
//             });
//         }
//     }
//
//     handleSortSwitchClickCallback() {
//         console.log(this);
//         if ($(this).text() === "Least Severe") {
//             $(this).text("Most Severe");
//         } else {
//             $(this).text("Least Severe");
//         }
//
//         let sortType = $(this).attr('val');
//         console.log(sortType);
//         console.log(this);
//         this.setStatus(sortType, this._status[sortType] * -1);
//
//         //TODO: Can we do this without referencing sg namespace?
//         sg.cardContainer.sortCards();
//     }
//
//     // TODO: we could use get status(), but we need to figure out a new way to do set status(newVal)
//     get status() {
//         return this._status;
//     }
//
//     setStatus(key, value) {
//         if (key in this._status) {
//             this._status[key] = value;
//         } else {
//             throw "Illegal status name";
//         }
//     }
// }

/**
 * CardSort Menu module. This is responsible for holding the switches
 * allowing users to sort labels on various parameters
 *
 * @returns {CardSortMenu}
 * @constructor
 */
function CardSortMenu(uiCardSortMenu) {
    let self = this;

    let orderCodes = {
        sort_LeastSevere: 0,
        sort_MostSevere: 1 
    }

    let status = {
        severity: 1,
        sortType: "none"
    };

    function _init() {
        if (uiCardSortMenu) {
            uiCardSortMenu.sort.bind({
                change: handleSortSwitchClickCallback
            });
        }
    }

    function handleSortSwitchClickCallback() {
        let sortType = $(this).val();
        setStatus("sortType", sortType);

        console.log("sort clicked");

        //TODO: Can we do this without referencing sg namespace?
        sg.cardContainer.sortCards(orderCodes[sortType]);
    }

    // TODO: perhaps remove this if no other status added
    function getStatus() {
        return status;
    }

    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    self.getStatus = getStatus;
    self.setStatus = setStatus;

    _init();
    return this;
}
/**
 * Ribbon Menu module. This is responsible for holding the buttons
 * allowing users to filter labels by label type
 *
 * @returns {RibbonMenu}
 * @constructor
 */
function RibbonMenu(uiRibbonMenu) {
    let self = this;

    let status = {
        currentLabelType: null
    };

    function _init() {
        if (uiRibbonMenu) {
            uiRibbonMenu.select.bind({
                change: handleLabelSelectSwitchChangeCallback
            })
        }
    }

    function handleLabelSelectSwitchChangeCallback() {
        let labelType = $(this).val();
        setStatus("currentLabelType", labelType);
        sg.tracker.push("Filter_LabelType=" + labelType);
        sg.tagContainer.update();
    }


    function getCurrentLabelType() {
        return status.currentLabelType;
    }

    // TODO: perhaps remove this if no other status added
    function getStatus() {
        return status;
    }

    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    self.getCurrentLabelType = getCurrentLabelType;
    self.getStatus = getStatus;
    self.setStatus = setStatus;

    _init();
    return this;
}

function Severity (params){
    let self = this;


    let severityElement = null;

    let properties = {
        severity: undefined
    };



    // a boolean to see if the current severity filter is active
    let active = false;

    /**
     * 
     * @param {int} param severity
     */
    function _init(param) {
        
        properties.severity = param;
        severityElement = document.createElement('div');
        severityElement.className = 'gallery-severity';
        severityElement.id = properties.severity;
        severityElement.innerText = properties.severity;

        severityElement.onclick = handleOnClickCallback;


    }

    function handleOnClickCallback(){
        if (active){
            sg.tracker.push("SeverityApply", null, {
                Severity: properties.severity
            });
            unapply();
        } else {
            sg.tracker.push("SeverityUnapply", null, {
                Severity: properties.severity
            });
            apply();
        }

        sg.cardContainer.updateCardsBySeverity();
    }

    // function toggleActive(){
    //     active = !active;
    // }

    function apply() {
        active = true;
        severityElement.setAttribute("style", "background-color: #78c8aa");
    }

    function unapply() {
        active = false;
        severityElement.setAttribute("style", "background-color: none");
    }

    function render(filterContainer) {
        filterContainer.append(severityElement);
    }

    function getActive(){
        return active;
    }

    function getSeverity() {
        return properties.severity;
    }

    self.handleOnClickCallback = handleOnClickCallback;
    //self.toggleActive = toggleActive;
    self.apply = apply;
    self.unapply = unapply;
    self.getActive = getActive;
    self.getSeverity = getSeverity;
    self.render = render;

    _init(params);

    return this;
}
/**
 * A Severity Bucket to store Severities
 * @param bucket array containing Severities
 * @returns {SeverityBucket}
 * @constructor
 */
function SeverityBucket(bucket) {
    let self = this;

    bucket = bucket || [];

    function _init() {
        for(let i = 1; i <= 5; i++ ){
            push(new Severity(i));
        }
    }

    function push(tag) {
        bucket.push(tag);
    }

    function render(uiSeverityHolder) {
        bucket.forEach(severity => severity.render(uiSeverityHolder));
    }

    function unapplySeverities() {
        bucket.forEach(severity => severity.unapply());
    }

    function getSeverities() {
        return bucket;
    }

    function getSize() {
        return bucket.length;
    }

    function getAppliedSeverities() {
        return bucket.filter(severity => severity.getActive()).map(severity => severity.getSeverity());
    }

    function isSeverityApplied() {
        // for (let i = 0; i < bucket.length; i++){
        //     if (bucket[i].getActive()) {
        //         return true;
        //     }
        // }
        // return false;
        return getAppliedSeverities().length > 0;
    }

    self.push = push;
    self.render = render;
    self.unapplySeverities = unapplySeverities;
    self.getSeverities = getSeverities;
    self.getSize = getSize;
    self.getAppliedSeverities = getAppliedSeverities;
    self.isSeverityApplied = isSeverityApplied;

    _init();

    return this;
}
/**
 * A Tag module.
 * @param params
 * @returns {Tag}
 * @constructor
 */
function Tag (params) {
    let self = this;

    let tagElement = null;

    // Id of the tag this Tag represents
    let properties = {
        tag_id: undefined,
        label_type: undefined,
        tag: undefined
    };

    // Status of the tag
    // TODO: Maybe call it selected?
    let status = {
        applied: false
    };

    function _init (param) {
        for (let attrName in param) {
            properties[attrName] = param[attrName];
        }

        tagElement = document.createElement('div');
        tagElement.className = "gallery-tag";
        tagElement.id = properties.tag;
        tagElement.innerText = properties.tag;

        tagElement.onclick = handleTagClickCallback;
    }

    function handleTagClickCallback() {
        if (status.applied) {
            sg.tracker.push("TagUnapply", null, {
                Tag: properties.tag,
                Label_Type: properties.label_type
            });
            unapply();
        } else {
            sg.tracker.push("TagApply", null, {
                Tag: properties.tag,
                Label_Type: properties.label_type
            });
            apply();
        }

        sg.cardContainer.updateCardsByTag();
    }

    function apply() {
        setStatus("applied", true);
        console.log("clicked and toggled on");
        tagElement.setAttribute("style", "background-color: #78c8aa");
    }

    function unapply() {
        setStatus("applied", false);
        console.log("clicked and toggled off");
        tagElement.setAttribute("style", "background-color: none");
    }

    function getTag() {
        return properties.tag;
    }

    /**
     * This function returns the tagId
     * @returns {*}
     */
    function getTagId() {
        return properties.tag_id;
    }

    function getLabelType() {
        return properties.label_type;
    }

    /**
     * Return the deep copy of the properties object,
     * so the caller can only modify properties from
     * setProperties() (which I have not implemented.)
     * JavaScript Deepcopy
     * http://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-clone-a-javascript-object
     */
    function getProperties() { return $.extend(true, {}, properties); }

    /**
     * Get a property
     * @param propName
     * @returns {boolean}
     */
    function getProperty(propName) { return (propName in properties) ? properties[propName] : false; }

    /**
     * Get status of tag
     */
    function getStatus() {
        return status;
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
     * Set status of tag
     */
    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    /**
     * This method renders the tag
     * @param filterContainer
     * @returns {self}
     */
    function render(filterContainer) {
        filterContainer.append(tagElement);
    }

    self.apply = apply;
    self.unapply = unapply;
    self.getTag = getTag;
    self.getTagId = getTagId;
    self.getLabelType = getLabelType;
    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.getStatus = getStatus;
    self.setProperty = setProperty;
    self.setStatus = setStatus;
    self.render = render;

    _init(params);
    return this;
}
/**
 * A Tag Bucket to store Tags of a certain label type
 * @param bucket array containing Tags
 * @returns {TagBucket}
 * @constructor
 */
function TagBucket(bucket) {
    let self = this;

    bucket = bucket || [];

    function push(tag) {
        bucket.push(tag);
    }

    function render(uiTagHolder) {
        bucket.forEach(tag => tag.render(uiTagHolder));
    }

    function unapplyTags() {
        bucket.forEach(tag => tag.unapply());
    }

    function getTags() {
        return bucket;
    }

    function getSize() {
        return bucket.length;
    }

    function getAppliedTags() {
        return bucket.filter(tag => tag.getStatus().applied);
    }

    self.push = push;
    self.render = render;
    self.unapplyTags = unapplyTags;
    self.getTags = getTags;
    self.getSize = getSize;
    self.getAppliedTags = getAppliedTags;

    return this;
}
/**
 * A Validation Menu to be appended to a Card for validation purposes
 * @param uiCardImage the html element to append the validation menu to
 * @param cardProperties properties of the label the validation menu is being appended to
 * @returns {ValidationMenu}
 * @constructor
 */
function ValidationMenu(uiCardImage, cardProperties) {
    let resultOptions = {
        "Agree": 1, 
        "Disagree": 2,
        "NotSure": 3
    };

    let currSelected = null;

    const overlayHTML = `
        <div id="gallery-validation-button-holder">
            <button id="gallery-card-agree-button" class="validation-button">Agree</button>
            <button id="gallery-card-disagree-button" class="validation-button">Disagree</button>
            <button id="gallery-card-not-sure-button" class="validation-button">Not Sure</button>
        </div>
    `;

    let overlay = $(overlayHTML);

    let agreeButton = overlay.find("#gallery-card-agree-button");
    let disagreeButton = overlay.find("#gallery-card-disagree-button");
    let notSureButton = overlay.find("#gallery-card-not-sure-button");

    function _init() {
        // TODO: compress this code
        agreeButton.click(function() {
            if (currSelected) {
                currSelected.attr('class', 'validation-button');
            }

            currSelected = agreeButton;
            agreeButton.attr('class', 'validation-button-selected');

            validateLabel("Agree");
        });
        
        disagreeButton.click(function() {
            if (currSelected) {
                currSelected.attr('class', 'validation-button');
            }

            currSelected = disagreeButton;
            disagreeButton.attr('class', 'validation-button-selected');

            validateLabel("Disagree");
        });
        
        notSureButton.click(function() {
            if (currSelected) {
                currSelected.attr('class', 'validation-button');
            }

            currSelected = notSureButton;
            notSureButton.attr('class', 'validation-button-selected');

            validateLabel("NotSure");
        });

        uiCardImage.appendChild(overlay[0]);
    }

    /**
     * Consolidate data on the validation and submit as a POST request.
     * @param action
     * @private
     */
    function validateLabel(action) {
        console.log("validate method called");

        // TODO: do we need this log?
        //sg.tracker.push("Validate_MenuClick=" + action);
        let validationTimestamp = new Date().getTime();

        let data = {
            label_id: cardProperties.label_id,
            label_type: cardProperties.label_type,
            validation_result: resultOptions[action],
            canvas_x: cardProperties.canvas_x,
            canvas_y: cardProperties.canvas_y,
            heading: cardProperties.heading,
            pitch: cardProperties.pitch,
            zoom: cardProperties.zoom,
            canvas_height: cardProperties.canvas_height,
            canvas_width: cardProperties.canvas_width,
            start_timestamp: validationTimestamp,
            end_timestamp: validationTimestamp,
            is_mobile: false
        };

        // Submit the validation via POST request.
        $.ajax({
            async: true,
            contentType: 'application/json; charset=utf-8',
            url: "/validationLabelMap",
            type: 'post',
            data: JSON.stringify(data),
            dataType: 'json',
            success: function (result) {
                showConfirmation(action);
            },
            error: function (result) {
                console.error(result);
            }
        });
    }

    function showConfirmation(action) {
        console.log(action + ": validation submitted successfully :)");
    }

    _init();
    return this;
}
/** @namespace */
var sg = sg || {};

/**
 * Main module for SidewalkGallery
 * @param param    Object passed from sidewalkGallery.scala.html containing initial values pulled from
 *                  the database on page load.
 * @returns {Main}
 * @constructor
 */
function Main (params) {
    let self = this;

    function _initUI() {
        sg.ui = {};
        sg.ui.cardFilter = {};
        sg.ui.cardFilter.holder = $("#card-filter");
        sg.ui.cardFilter.tags = $("#tags");
        sg.ui.cardFilter.severity = $("#severity");
        sg.ui.ribbonMenu = {};
        sg.ui.ribbonMenu.holder = $("#ribbon-menu-holder");
        sg.ui.ribbonMenu.select = $('#label-select');
        sg.ui.cardSortMenu = {};
        sg.ui.cardSortMenu.holder = $("#card-sort-menu-holder");
        sg.ui.cardSortMenu.sort = $('#card-sort-select');
        sg.ui.cardContainer = {};
        sg.ui.cardContainer.holder = $("#image-card-container");
        sg.ui.cardContainer.prevPage = $("#prev-page");
        sg.ui.cardContainer.pageNumber = $("#page-number")
        sg.ui.cardContainer.nextPage = $("#next-page");
    }

    function _init() {
        console.log("Sidewalk Gallery initialized");
        sg.rootDirectory = ('rootDirectory' in params) ? params.rootDirectory : '/';

        sg.ribbonMenu = new RibbonMenu(sg.ui.ribbonMenu);
        // sg.cardSortMenu = new CardSortMenu(sg.ui.cardSortMenu);
        sg.tagContainer = new CardFilter(sg.ui.cardFilter, sg.ribbonMenu);
        sg.cardContainer = new CardContainer(sg.ui.cardContainer);

        sg.form = new Form(params.dataStoreUrl, params.beaconDataStoreUrl)
        sg.tracker = new Tracker();

        sg.util = {};
        sg.util.properties = {};
        sg.util.properties.panorama = new GalleryPanoUtilities();
    }

    i18next.use(i18nextXHRBackend);
    i18next.init({
        backend: { loadPath: '/assets/locales/{{lng}}/{{ns}}.json' },
        fallbackLng: 'en',
        ns: ['gallery', 'common'],
        defaultNS: 'gallery',
        lng: params.language,
        debug: false
    }, function(err, t) {
        if (err) return console.log('something went wrong loading', err);
        t('key'); // -> same as i18next.t
    });

    _initUI();
    _init();

    return self;
}

/**
 * Holds Panomarker/Panorama calculations. These functions are borrowed from the
 * PanoMarker script.
 * @returns {GalleryPanoUtilities}
 * @constructor
 */
function GalleryPanoUtilities () {
    let self = this;

    // Returns image paths corresponding to each label type.
    function getIconImagePaths(category) {
        let imagePaths = {
            CurbRamp: {
                id: 'CurbRamp',
                iconImagePath : sg.rootDirectory + 'img/cursors/Cursor_CurbRamp.png'
            },
            NoCurbRamp: {
                id: 'NoCurbRamp',
                iconImagePath : sg.rootDirectory + 'img/cursors/Cursor_NoCurbRamp.png'
            },
            Obstacle: {
                id: 'Obstacle',
                iconImagePath: sg.rootDirectory + 'img/cursors/Cursor_Obstacle.png'
            },
            SurfaceProblem: {
                id: 'SurfaceProblem',
                iconImagePath: sg.rootDirectory + 'img/cursors/Cursor_SurfaceProblem.png'
            },
            Other: {
                id: 'Other',
                iconImagePath: sg.rootDirectory + 'img/cursors/Cursor_Other.png'
            },
            Occlusion: {
                id: 'Occlusion',
                iconImagePath: sg.rootDirectory + 'img/cursors/Cursor_Other.png'
            },
            NoSidewalk: {
                id: 'NoSidewalk',
                iconImagePath: sg.rootDirectory + 'img/cursors/Cursor_NoSidewalk.png'
            },
            Void: {
                id: 'Void',
                iconImagePath : null
            }
        };

        return category ? imagePaths[category] : imagePaths;
    }

    /**
     * From PanoMarker spec
     * @param zoom
     * @returns {number}
     */
    function _get3dFov (zoom) {

    }

    /**
     * Given the current POV, this method calculates the Pixel coordinates on the
     * given viewport for the desired POV. All credit for the math this method goes
     * to user3146587 on StackOverflow: http://goo.gl/0GGKi6
     *
     * My own approach to explain what is being done here (including figures!) can
     * be found at http://martinmatysiak.de/blog/view/panomarker
     *
     * @param {StreetViewPov} targetPov The point-of-view whose coordinates are
     *     requested.
     * @param {StreetViewPov} currentPov POV of the viewport center.
     * @param {number} zoom The current zoom level.
     * @param {number} Width of the panorama canvas.
     * @param {number} Height of the panorama canvas.
     * @return {Object} Top and Left offsets for the given viewport that point to
     *     the desired point-of-view.
     */
    function povToPixel3d (targetPov, currentPov, zoom, canvasWidth, canvasHeight) {

        // Gather required variables and convert to radians where necessary
        let width = canvasWidth;
        let height = canvasHeight;

        // Corrects width and height for mobile phones
        if (isMobile()) {
            width = window.innerWidth;
            height = window.innerHeight;
        }

        let target = {
            left: width / 2,
            top: height / 2
        };

        let DEG_TO_RAD = Math.PI / 180.0;
        let fov = _get3dFov(zoom) * DEG_TO_RAD;
        let h0 = currentPov.heading * DEG_TO_RAD;
        let p0 = currentPov.pitch * DEG_TO_RAD;
        let h = targetPov.heading * DEG_TO_RAD;
        let p = targetPov.pitch * DEG_TO_RAD;

        // f = focal length = distance of current POV to image plane
        let f = (width / 2) / Math.tan(fov / 2);

        // our coordinate system: camera at (0,0,0), heading = pitch = 0 at (0,f,0)
        // calculate 3d coordinates of viewport center and target
        let cos_p = Math.cos(p);
        let sin_p = Math.sin(p);

        let cos_h = Math.cos(h);
        let sin_h = Math.sin(h);

        let x = f * cos_p * sin_h;
        let y = f * cos_p * cos_h;
        let z = f * sin_p;

        let cos_p0 = Math.cos(p0);
        let sin_p0 = Math.sin(p0);

        let cos_h0 = Math.cos(h0);
        let sin_h0 = Math.sin(h0);

        let x0 = f * cos_p0 * sin_h0;
        let y0 = f * cos_p0 * cos_h0;
        let z0 = f * sin_p0;

        let nDotD = x0 * x + y0 * y + z0 * z;
        let nDotC = x0 * x0 + y0 * y0 + z0 * z0;

        // nDotD == |targetVec| * |currentVec| * cos(theta)
        // nDotC == |currentVec| * |currentVec| * 1
        // Note: |currentVec| == |targetVec| == f

        // Sanity check: the vectors shouldn't be perpendicular because the line
        // from camera through target would never intersect with the image plane
        if (Math.abs(nDotD) < 1e-6) {
            return null;
        }

        // t is the scale to use for the target vector such that its end
        // touches the image plane. It's equal to 1/cos(theta) ==
        //     (distance from camera to image plane through target) /
        //     (distance from camera to target == f)
        let t = nDotC / nDotD;

        // Sanity check: it doesn't make sense to scale the vector in a negative
        // direction. In fact, it should even be t >= 1.0 since the image plane
        // is always outside the pano sphere (except at the viewport center)
        if (t < 0.0) {
            return null;
        }

        // (tx, ty, tz) are the coordinates of the intersection point between a
        // line through camera and target with the image plane
        let tx = t * x;
        let ty = t * y;
        let tz = t * z;

        // u and v are the basis vectors for the image plane
        let vx = -sin_p0 * sin_h0;
        let vy = -sin_p0 * cos_h0;
        let vz = cos_p0;

        let ux = cos_h0;
        let uy = -sin_h0;
        let uz = 0;

        // normalize horiz. basis vector to obtain orthonormal basis
        let ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
        ux /= ul;
        uy /= ul;
        uz /= ul;

        // project the intersection point t onto the basis to obtain offsets in
        // terms of actual pixels in the viewport
        let du = tx * ux + ty * uy + tz * uz;
        let dv = tx * vx + ty * vy + tz * vz;

        // use the calculated pixel offsets
        target.left += du;
        target.top -= dv;

        return target;
    }

    self.getIconImagePaths = getIconImagePaths;
    self.get3dFov = _get3dFov;
    self.povToPixel3d = povToPixel3d;

    return this;
}