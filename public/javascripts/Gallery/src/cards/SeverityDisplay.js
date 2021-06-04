function SeverityDisplay(container, severity) {
    let self = this;
    self.severity = severity;
    self.severityContainer = container;

    let circles = []
    function _init() {
        let holder = document.createElement('div')
        holder.className = 'label-severity-content'

        for (let i = 1; i <= 5; i++) {
            let severityCircle = document.createElement('div')
            severityCircle.className = 'severity-circle'
            severityCircle.innerText = i;
            circles.push(severityCircle)
        }
        if (severity) {
            $(circles[severity - 1]).attr('id', 'current-severity')
        }
        for (let i = 0; i < circles.length; i++) {
            holder.appendChild(circles[i])
        }
        container.append(holder)
    }

    _init()
    return self;
}