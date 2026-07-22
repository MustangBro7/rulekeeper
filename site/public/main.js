(function () {
  'use strict';

  document.documentElement.classList.add('js');

  var menuButton = document.querySelector('.menu-toggle');
  var menu = document.querySelector('.nav-links');
  var closeMenu = function () {
    menuButton.setAttribute('aria-expanded', 'false');
    menu.classList.remove('is-open');
  };

  menuButton.addEventListener('click', function () {
    var willOpen = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(willOpen));
    menu.classList.toggle('is-open', willOpen);
  });
  menu.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', closeMenu);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menuButton.focus();
    }
  });

  var terminal = document.querySelector('.term');
  terminal.querySelectorAll('.rule-line').forEach(function (line, index) {
    line.style.setProperty('--line-index', index);
  });
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        terminal.classList.add('is-revealed');
        observer.disconnect();
      }
    }, { threshold: 0.25 });
    observer.observe(terminal);
  } else {
    terminal.classList.add('is-revealed');
  }

  var copyButton = document.querySelector('.copy');
  var copyStatus = document.querySelector('.copy-status');
  var fallbackCopy = function (text) {
    var input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    var copied = false;
    try { copied = document.execCommand('copy'); } catch (error) { copied = false; }
    input.remove();
    return copied;
  };
  copyButton.addEventListener('click', function () {
    var command = copyButton.dataset.copyCommand;
    var operation;
    try {
      operation = navigator.clipboard && window.isSecureContext
        ? navigator.clipboard.writeText(command).then(function () { return true; }, function () { return fallbackCopy(command); })
        : Promise.resolve(fallbackCopy(command));
    } catch (error) {
      operation = Promise.resolve(fallbackCopy(command));
    }
    operation.then(function (copied) {
      if (!copied) return;
      copyButton.textContent = '[copied]';
      copyStatus.textContent = 'Command copied to clipboard.';
      window.setTimeout(function () {
        copyButton.textContent = '[copy]';
        copyStatus.textContent = '';
      }, 2000);
    }).catch(function () {});
  });

  var form = document.querySelector('.waitlist-form');
  var formStatus = form.querySelector('.form-status');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var endpoint = form.dataset.waitlistEndpoint.trim();
    if (!endpoint) {
      formStatus.innerHTML = 'Waitlist opens at launch — <a href="https://github.com/" rel="noopener">star the repo to follow along.</a>';
      return;
    }
    var submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    formStatus.textContent = 'Joining…';
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.elements.email.value })
    }).then(function (response) {
      if (!response.ok) throw new Error('Request failed');
      formStatus.textContent = 'You’re on the list.';
      form.reset();
    }).catch(function () {
      formStatus.textContent = 'Something went wrong. Please try again.';
    }).finally(function () {
      submit.disabled = false;
    });
  });
}());
