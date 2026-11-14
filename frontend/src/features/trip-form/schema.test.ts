import { fieldErrorsFromDetails, formLevelMessages } from './schema'

test.each([
  [{ load_weight_lb: ['Too heavy.'] }, { loadWeightLb: 'Too heavy.' }],
  [
    { departure_local: 'Departure is in the past.' },
    { departureLocal: 'Departure is in the past.' },
  ],
  // DRF nests errors of a nested serializer per sub-field.
  [
    { destination: { lat: ['Ensure this value is less than or equal to 90.'] } },
    { destination: 'Ensure this value is less than or equal to 90.' },
  ],
  [{ origin: ['Required.', 'Pick a place.'] }, { origin: 'Required. Pick a place.' }],
  [{ non_field_errors: ['Same place.'], request_id: 'abc' }, {}],
  [{ origin: [] }, {}],
])('fieldErrorsFromDetails(%o)', (details, expected) => {
  expect(fieldErrorsFromDetails(details)).toEqual(expected)
})

test.each([
  ['a field error is shown inline', { origin: ['Required.'] }, null],
  ['no details (routing BAD_INPUT)', {}, []],
  ['non-field errors', { non_field_errors: ['Same place.'] }, ['Same place.']],
  ['request id is not a message', { request_id: 'abc', X: 'y' }, ['y']],
])('formLevelMessages: %s', (_name, details, expected) => {
  expect(formLevelMessages(details)).toEqual(expected)
})
