/**
 * template.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */


define(['N/file'], ({ load }) => {
    const render = ({ file, slots }) => {
        const template = load({
            id: `SuiteScripts/billabex/libs/templates/${file}`
        });

        let htmlFile = template.getContents();

        for (const slot of Object.keys(slots)) {
            htmlFile = htmlFile.replace(`{{${slot}}}`, slots[slot]);
        }

        return htmlFile;
    }

    const layout = ({ content, title }) => {

        return render({
            file: 'layout.html',
            slots: {
                title,
                content
            }
        });
    }
    return { layout, render }
});
