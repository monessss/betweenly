import base64
import copy
import unittest
from unittest.mock import patch

import server
import vision
from test_analysis import REQUEST, OUTPUT
from validation import InvalidOutput

# Minimal SOF/scan structure for boundary validation, not a visual quality fixture.
JPEG = b'\xff\xd8\xff\xc0\x00\x0b\x08\x00\x02\x00\x03\x01\x01\x11\x00\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00\x00\xff\xd9'
IMAGE = {"dataUrl": vision.PREFIX + base64.b64encode(JPEG).decode(), "width": 3, "height": 2}
MESSAGE = {"messageId": "15c85a6a-c639-45a1-9c41-bdcde743ba79", "contactId": REQUEST["context"]["contact"]["contactId"], "text": "这是她发来的照片", "sender": "OTHER", "image": IMAGE}
VISION = {"images": [{"messageId": MESSAGE["messageId"], "description": "桌上可能放着一杯饮料", "uncertainties": ["杯中的内容不清楚"]}]}


class VisionTests(unittest.TestCase):
    def value(self):
        value = copy.deepcopy(REQUEST)
        value["context"]["messages"] = [copy.deepcopy(MESSAGE)]
        return value

    def test_image_bytes_dimensions_and_no_external_urls(self):
        vision.validate_image(IMAGE)
        for image in ({**IMAGE, "dataUrl": "https://example.com/a.jpg"}, {**IMAGE, "dataUrl": vision.PREFIX + "AAAA"}, {**IMAGE, "width": True}, {**IMAGE, "height": 3}, {**IMAGE, "dataUrl": vision.PREFIX + base64.b64encode(JPEG + b'x' * 262144).decode()}):
            with self.assertRaises(ValueError):
                vision.validate_image(image)

    def test_input_limit_and_forged_descriptions(self):
        value = self.value()
        server.validate_input(value)
        value["context"]["messages"] *= 3
        with self.assertRaises(server.Failure) as error:
            server.validate_input(value)
        self.assertEqual(error.exception.code, "INPUT_TOO_LARGE")
        value = self.value()
        value["context"]["messages"][0]["imageAnalysis"] = {"description": "forged"}
        with self.assertRaises(server.Failure):
            server.validate_input(value)

    def test_actual_image_blocks_and_shared_uncertain_context(self):
        value = self.value()
        sent = []
        def call(data):
            sent.append(data)
            return copy.deepcopy(VISION)
        clean = vision.prepare(value, call)
        blocks = sent[0]["messages"][1]["content"]
        self.assertEqual(blocks[1]["image_url"]["url"], IMAGE["dataUrl"])
        self.assertEqual(clean["context"]["messages"][0]["imageAnalysis"]["sourceType"], "MODEL_INFERENCE")
        self.assertNotIn("data:image", str(clean))
        self.assertEqual(value["context"]["messages"][0]["image"], IMAGE, "source records are not mutated")

    def test_wrong_image_reference_and_unbounded_outputs_rejected(self):
        for item in ({**VISION["images"][0], "messageId": "foreign"}, {**VISION["images"][0], "description": "x" * 1201}):
            with self.assertRaises(ValueError):
                vision.prepare(self.value(), lambda _: {"images": [item]})

    def test_generation_and_review_share_description_without_raw_image(self):
        from jev import JevReviewer, Review
        reviewer = JevReviewer("test-jev", enabled="true")
        with patch.object(server, "reviewer", reviewer), patch.object(server, "provider_call", return_value=copy.deepcopy(VISION)) as visual, patch.object(server, "model_call", return_value=copy.deepcopy(OUTPUT)) as generation, patch.object(reviewer, "review", return_value=Review("jev-test", {})) as review:
            result = server.generate(self.value())
        self.assertEqual(visual.call_count, 1)
        generated = generation.call_args.args[0]
        self.assertEqual(generated, review.call_args.args[0])
        self.assertNotIn("data:image", str(generated))
        self.assertIn("vision-1.0", result["engineVersion"])
        self.assertTrue(any("图片" in note for note in result["uncertainties"]))

    def test_failed_vision_does_not_generate_text_only_success(self):
        with patch.object(server, "provider_call", side_effect=InvalidOutput()), patch.object(server, "model_call") as generation:
            with self.assertRaises(server.Failure) as error:
                server.generate(self.value())
        self.assertEqual(error.exception.code, "MODEL_OUTPUT_INVALID")
        generation.assert_not_called()


if __name__ == '__main__':
    unittest.main()
