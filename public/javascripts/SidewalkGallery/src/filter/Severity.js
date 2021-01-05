
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