<?php

namespace Drupal\valet\Element;

use Drupal\Core\Render\Element\RenderElement;

/**
 * Provides a render element for Valet.
 *
 * @RenderElement("valet")
 */
class Valet extends RenderElement {

  /**
   * {@inheritdoc}
   */
  public function getInfo() {
    $class = get_class($this);
    $info = [
      '#theme' => 'valet',
      '#attached' => [
        'library' => [
          'valet/valet',
        ],
      ],
      '#pre_render' => [
        [$class, 'preRenderValet'],
      ],
      // Metadata for the valet wrapping element.
      '#attributes' => [
        'id' => 'valet',
        'class' => ['valet'],
        'role' => 'group',
        'aria-label' => $this->t('Valet quick navigation'),
      ],
    ];
    return $info;
  }

  /**
   * Prepares a #type 'valet' render element for input.html.twig.
   */
  public static function preRenderValet($element) {
    $element['#attributes']['data-cache-id'] = \Drupal::state()->get('valet.cache_id') . '-' . \Drupal::currentUser()->id();
    return $element;
  }

}
