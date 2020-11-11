
function Severity (params){
    let self = this;


    let severityElement = null;

    let properties = {
        severity: undefined
    };



    // a boolean to see if the current severity filter is active
    let active = true;

    /**
     * 
     * @param {int} param severity
     */
    function _init(param) {
        
        properties.severity = param;
        severityElement = document.createElement('div');
        severityElement.className = 'gallery-tag';
        severityElement.id = properties.severity;
        severityElement.innerText = properties.severity;

        severityElement.onclick = handleOnClickCallback;


    }

    function handleOnClickCallback(){
        toggleActive();

        if (active){
            severityElement.setAttribute("style", "background-color: coral");
        } else {
            severityElement.setAttribute("style", "background-color: none");
        }

        //sg.cardContainer.updateCardsBySeverity();
        sg.cardContainer.render();
    }

    function toggleActive(){
        active = !active;
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
    self.toggleActive = toggleActive;
    self.getActive = getActive;
    self.getSeverity = getSeverity;
    self.render = render;

    _init(params);

    return this;
}