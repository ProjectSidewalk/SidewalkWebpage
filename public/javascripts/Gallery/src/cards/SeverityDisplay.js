function SeverityDisplay(container, severity, isModal=false) {
    let self = this;
    self.severity = severity;
    self.severityContainer = container;

    let circles = []
    function _init() {
        let severityCircleClass = isModal ? 'modal-severity-circle' : 'severity-circle'
        let selectedCircleID = isModal ? 'modal-current-severity' : 'current-severity'

        let holder = document.createElement('div')
        holder.className = 'label-severity-content'

        let title = document.createElement('div')
        title.innerHTML = '<b>Severity:</b>'
        container.append(title)

        for (let i = 1; i <= 5; i++) {
            let severityCircle = document.createElement('div')
            severityCircle.className = severityCircleClass
            severityCircle.innerText = i;
            circles.push(severityCircle)
        }
        if (severity) {
            $(circles[severity - 1]).attr('id', selectedCircleID)
        }
        for (let i = 0; i < circles.length; i++) {
            holder.appendChild(circles[i])
        }
        container.append(holder)
 
      
    }

    _init()
    return self;
}