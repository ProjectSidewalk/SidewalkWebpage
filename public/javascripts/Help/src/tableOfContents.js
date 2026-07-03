$(document).ready(() => {
    /*
    Any h2 tag with a "question" class will be added to questions list
     */
    $('h2.question').each(function () {
        const listItem = `<li><a href='#${$(this).attr('id')}'>${$(this).text()}</a></li>`;
        $('#questions-list').append(listItem);
    });
});
