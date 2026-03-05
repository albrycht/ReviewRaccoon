"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("checkPage");
  if (!button) {
    return;
  }
  button.addEventListener("click", () => {
    window.close();
  });
});
