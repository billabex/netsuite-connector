/**
 * components.js
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define(['./template'], (template) => {

    const variantClass = (variant) => {
        switch (variant) {
            case 'primary':
                return 'bg-[#003049] text-white shadow-md shadow-[#003049]/25 hover:bg-[#00263a]';
            case 'secondary':
                return 'bg-white text-[#003049] border border-[#003049]/30 shadow-md shadow-[#003049]/10 hover:bg-[#f7f8fb] hover:border-[#003049]/45';
            case 'tertiary':
                return 'bg-[#003049]/5 text-[#003049] border border-[#003049]/15 shadow-sm shadow-[#003049]/5 hover:bg-[#003049]/10 hover:border-[#003049]/25';
            default:
                return 'bg-[#003049]/5 text-[#003049] border border-[#003049]/15 shadow-sm shadow-[#003049]/5 hover:bg-[#003049]/10 hover:border-[#003049]/25';
        }
    }

    const Status = ({ label, status }) => {
        const badgeClass = (status) => {
            switch (status) {
                case 'success':
                    return 'bg-green-100 text-green-700';
                case 'pending':
                    return 'bg-amber-100 text-amber-700';
                case 'warning':
                    return 'bg-orange-100 text-orange-700';
                case 'error':
                default:
                    return 'bg-[#d62828]/10 text-[#d62828]';
            }
        }


        return template.render({
            file: 'components/status.html',
            slots: {
                label,
                badgeClass: badgeClass(status)
            }
        });
    }


    const Button = ({ label, link, variant }) => {
        return template.render({
            file: 'components/button.html',
            slots: {
                label,
                link,
                variantClass: variantClass(variant)
            }
        });
    }

    const SubmitButton = ({ label, variant }) => {
        return template.render({
            file: 'components/button-submit.html',
            slots: {
                label,
                variantClass: variantClass(variant)
            }
        });
    }

    const Select = ({ label, name, options, helpText }) => {
        return template.render({
            file: 'components/select.html',
            slots: {
                label,
                name,
                options,
                helpText
            }
        });
    }

    return {
        Status,
        Button,
        SubmitButton,
        Select,
    }
});
