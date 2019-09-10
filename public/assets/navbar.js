"use strict";
(function() {
    let mobileMenuOpen = false;

    window.onload = function() {
        document.getElementById("mobile-menu-button").onclick = function () {
            if (mobileMenuOpen) {
                document.getElementById("mobile-menu").style.display="none";
                document.querySelector(".fa").classList.add("fa-bars");
                document.querySelector(".fa").classList.remove("fa-times");
                mobileMenuOpen = false;
            } else {
                document.getElementById("mobile-menu").style.display="block";
                document.querySelector(".fa").classList.remove("fa-bars");
                document.querySelector(".fa").classList.add("fa-times");
                mobileMenuOpen = true;
            }

        }
    }

})();