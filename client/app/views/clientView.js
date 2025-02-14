define(['jquery', 'controllers/clientController', 'controllers/tableController', 'controllers/usabilityController', 'helper/drop_sheet', 'spin', 'Ladda', 'ResizeSensor', 'table_template', 'alertHandler', 'bootstrap'],
  function ($, clientController, tableController, usabilityController, DropSheet, Spinner, Ladda, ResizeSensor, table_template, alertHandler) {
    function createQuestionText(text) {
      var p = document.createElement('p');
      p.classList.add('question-text');
      p.classList.add('help-block');
      p.innerHTML = text;
      return p;
    }

    function renderSurveyInputs(question, form) {
      var input_type = question.input_type;

      for (var i = 0; i < question.inputs.length; i++) {
        var div = document.createElement('div');
        $(div).attr('class', input_type);

        var label = document.createElement('label');
        div.appendChild(label);

        var input = document.createElement('input');
        $(input).attr('type', input_type)
          .attr('value', i + 1)
          .attr('name', 'opt' + input_type);

        label.appendChild(input);
        $(label).append(question.inputs[i].label);
        form.appendChild(div);
      }
    }

    // Creates survey
    function displaySurveyQuestions() {
      $('#additional-questions').hide();
      if (!('survey' in table_template) || Object.keys(table_template.survey).length === 0) {
        return;
      }

      $('#additional-questions').show();
      var questions = table_template.survey.questions;
      var questionsDiv = $('#questions');
      for (var i = 0; i < questions.length; i++) {
        var form = document.createElement('form');
        form.append(createQuestionText(questions[i].question_text));
        renderSurveyInputs(questions[i], form);
        questionsDiv.append(form);
      }
    }

    function addResizeSensors(tables) {
      for (var i = 0; i < table_template.tables.length; i++) {
        var elem = table_template.tables[i].element;
        new ResizeSensor($('#' + elem).find('.wtHider').first()[0], function () {
          tableController.resetTableWidth();
        });
      }
    }

    function addDefinitionLink() {
      if (table_template.definitions) {
        $("#cohort-drop-label").append(' <a href="/definitions" target="_blank"><span class="glyphicon glyphicon-question-sign"></span></a>');
      }
    }

    function clientControllerView() {
      $(document).ready(function () {
        // Hide by default

        tableController.createTableElems(table_template.tables, '#tables-area');

        displaySurveyQuestions();
        // Create the tables
        var tables = tableController.makeTables(table_template.tables);

        usabilityController.initialize();
        usabilityController.saveBrowser();

        var totals_table = null;
        if (table_template.totals) {
          tableController.createTableElems([table_template.totals], '#totals-table');
          totals_table = tableController.makeTables([table_template.totals])[0];
        }

        var $verify = $('#verify');
        var $session = $('#session');
        var $participationCode = $('#participation-code');

        $('#choose-file').on('change', function (e) {
          var fileName = null;
          if (e.type === 'drop') {
            fileName = e.dataTransfer.files[0].name;
          } else if (e.type === 'change') {
            fileName = e.target.files[0].name;
          }

          $('#file-name').text(fileName);
        });

        $('#session, #participation-code').on('blur', function (e) {
          e.target.dataset['did_blur'] = true;
          clientController.validateSessionInput(e.target, true);
        });

        $('#session, #participation-code').on('input', function (e) {
          if (e.target.dataset['did_blur']) {
            clientController.validateSessionInput(e.target, false);
          }
          $verify.prop('checked', false);
        });

        //Copied from trusted/session_data
        var getParameterByName = function (name) {
          name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
          var regex = new RegExp('[\\?&]' + name + '=([^&#]*)'),
            results = regex.exec(location.search);
          return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
        };

        $participationCode.val(getParameterByName('participationCode'));
        $session.val(getParameterByName('session'));
        if (String($session.val()).trim() !== '') {
          $session.blur();
        }
        if (String($participationCode.val()).trim() !== '') {
          $participationCode.blur();
        }

        // Remove error from radio buttons once you click on them
        $('form input[type=radio]').on('change', function (e) {
          $(e.target.form).removeClass('has-error');
          $verify.prop('checked', false);
        });

        window.scrollTo(0, 0);

        var sums = [0, 0]; // Internal total of Non NaNs values.
        var NaNs = [0, 0]; // Counts how many NaNs exist for every cell participating in a total.

        // Custom afterChange hook that computes the totals
        var afterChange = function (changes) {
          if (table_template.totals) {
            if (changes === null) {
              return;
            }

            var running = tableController.checkTotals(totals_table, changes, sums, NaNs);
            sums = running.sums;
            NaNs = running.NaNs;
          }
        };

        addResizeSensors(tables);

        // Add link to definitions
        addDefinitionLink();

        // Table accordion.
        $('#tables-area').hide();
        $('#expand-table-button').click(function (e) {
          $('#tables-area').slideToggle(function () {
            if (!$('#tables-area').is(':hidden')) {
              tableController.updateWidth(tables);
            } else {
              tableController.resetTableWidth();
            }
          });
          $(e.target).toggleClass('flip');
        });

        var _target = document.getElementById('drop-area');
        var _choose = document.getElementById('choose-file-button');
        var spinner;
        var _workstart = function () {
          spinner = new Spinner().spin(_target);
        };
        var _workend = function (status) {
          $('#tables-area').show();
          tableController.updateWidth(tables);
          spinner.stop();
        };

        var _badfile = function () {
          alertHandler.error('This file does not appear to be a valid Excel file.', function () {
          });

          spinner.stop();
        };
        var _pending = function () {
          alertHandler.error('Please wait until the current file is processed.', function () {
          });
        };
        var _large = function (len, cb) {
          alertHandler.error('This file is ' + (len / (1024 * 1024)).toFixed(2) + ' MB and may take a few moments. Your browser may lock up during this process. Continue?', cb);
        };
        var _failed = function (e) {
          spinner.stop();
        };

        var _onsheet = function (json, cols, sheetnames, select_sheet_cb) {
          if (!json) {
            json = [];
          }
          /* add header row for table */
          json.unshift(function (head) {
            var o = {};

            for (i = 0; i !== head.length; ++i) {
              o[head[i]] = head[i];
            }

            return o;
          }(cols));
        };

        DropSheet({
          drop: _target,
          choose: _choose,
          tables: tables,
          tables_def: table_template,
          on: {workstart: _workstart, workend: _workend, sheet: _onsheet},
          errors: {badfile: _badfile, pending: _pending, failed: _failed, large: _large}
        });

        function addValidationErrors(msg) {
          $verify.prop('checked', false);
          $('#submit').prop('disabled', true);
          $('#errors').css('display', 'block');

          for (var i = 0; i < msg.length; i++) {
            $('#validation-errors').append('<li><span class="help-block">' + msg[i] + '</span></li>');
          }
        }

        // Register when ready
        tables[0].addHook('afterChange', afterChange);
        for (var i = 0; i < tables.length; i++) {
          tables[i].addHook('afterChange', function (changes, sources) {
            if (changes !== null) {
              $verify.prop('checked', false);
            }
          });
        }

        // Button clicks handlers
        $verify.click(function () {
          var la = Ladda.create(document.getElementById('verify'));
          la.start();

          clientController.validate(tables, function (result, msg) {
            $('#validation-errors').empty();
            la.stop();
            if (result) {
              $('#submit').prop('disabled', false);
              $('#errors').css('display', 'none');
            } else {
              addValidationErrors(msg);
            }
          });
        });

        $('#submit').click(function () {
          usabilityController.stopAllTimers();
          var la = Ladda.create(document.getElementById('submit'));
          la.start();

          clientController.validate(tables, function (result, msg) {
            $('#validation-errors').empty();
            if (!result) {
              la.stop();
              addValidationErrors(msg);
            } else {
              var cohort = clientController.getUserCohort();
              if (table_template['cohort_selection'] === true) {
                cohort = $('#cohortDrop').val();
              }
              clientController.constructAndSend(tables, cohort, la);
            }
          });
        });
      });

      /* global $buoop */
      // var $buoop = {
      //   vs: {i: 10, f: -4, o: -4, s: 8, c: -4},
      //   mobile: false,
      //   api: 4,
      //   noclose: true,
      //   reminder: 0,
      //   reminderClosed: 0,
      //   text: '<strong>Your web browser {brow_name} is not supported.</strong> Please upgrade to a more modern browser to participate in the Pacesetters Data Submission.'
      // };

      function $buo_f() {
        var e = document.createElement('script');
        e.src = '//browser-update.org/update.min.js';
        document.body.appendChild(e);
      }

      try {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', $buo_f, false)
        } else {
          $buo_f();
        }
      } catch (e) {
        if (document.readyState !== 'complete') {
          window.attachEvent('onload', $buo_f)
        } else {
          $buo_f();
        }
      }
    }

    return clientControllerView;

  });
