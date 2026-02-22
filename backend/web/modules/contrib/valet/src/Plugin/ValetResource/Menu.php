<?php

namespace Drupal\valet\Plugin\ValetResource;

use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;
use Drupal\Core\Menu\MenuLinkTreeInterface;
use Drupal\Core\Menu\LocalTaskManagerInterface;
use Drupal\Core\Access\AccessManagerInterface;
use Drupal\Core\Entity\EntityTypeManagerInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Menu\MenuTreeParameters;
use Drupal\Core\Render\BubbleableMetadata;
use Drupal\Core\Url;
use Drupal\valet\Plugin\ValetItem;
use Drupal\valet\Plugin\ValetResourceBase;

/**
 * Expose a Menu plugin.
 *
 * @ValetResource(
 *   id = "menu",
 *   label = @Translation("Menu"),
 *   weight = -1
 * )
 */
class Menu extends ValetResourceBase implements ContainerFactoryPluginInterface {

  /**
   * The entity type manager.
   *
   * @var \Drupal\Core\Entity\EntityTypeManagerInterface
   */
  protected $entityTypeManager;

  /**
   * The menu link tree service.
   *
   * @var \Drupal\Core\Menu\MenuLinkTreeInterface
   */
  protected $menuLinkTree;

  /**
   * The local task manager.
   *
   * @var \Drupal\Core\Menu\LocalTaskManagerInterface
   */
  protected $localTaskManager;

  /**
   * The access manager service.
   *
   * @var \Drupal\Core\Access\AccessManagerInterface
   */
  protected $accessManager;

  /**
   * Constructs a new ValetUser object.
   *
   * @param array $configuration
   *   A configuration array containing information about the plugin instance.
   * @param string $plugin_id
   *   The plugin_id for the plugin instance.
   * @param mixed $plugin_definition
   *   The plugin implementation definition.
   * @param \Drupal\Core\Entity\EntityTypeManagerInterface $entity_type_manager
   *   The entity type manager.
   * @param \Drupal\Core\Menu\MenuLinkTreeInterface $menu_link_tree
   *   Menu link tree.
   * @param \Drupal\Core\Menu\LocalTaskManagerInterface $local_task_manager
   *   Local task manager.
   * @param \Drupal\Core\Access\AccessManagerInterface $access_manager
   *   Access manager.
   */
  public function __construct(array $configuration, $plugin_id, $plugin_definition, EntityTypeManagerInterface $entity_type_manager, MenuLinkTreeInterface $menu_link_tree, LocalTaskManagerInterface $local_task_manager, AccessManagerInterface $access_manager) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);
    $this->entityTypeManager = $entity_type_manager;
    $this->menuLinkTree = $menu_link_tree;
    $this->localTaskManager = $local_task_manager;
    $this->accessManager = $access_manager;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    return new static(
      $configuration, $plugin_id, $plugin_definition,
      $container->get('entity_type.manager'),
      $container->get('menu.link_tree'),
      $container->get('plugin.manager.menu.local_task'),
      $container->get('access_manager')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration() {
    return [
      'menus' => [],
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function configurationForm(array $form, FormStateInterface $form_state) {
    $form['menus'] = [
      '#type' => 'checkboxes',
      '#title' => t('Available menus'),
      '#options' => $this->getMenuLabels(),
      '#default_value' => $this->getConfigurationValue('menus', []),
    ];
    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function configurationValidate(array &$form, FormStateInterface $form_state) {
    parent::configurationValidate($form, $form_state);
    $values = $form_state->getValues();
    if (isset($values['menus'])) {
      $values['menus'] = array_filter($values['menus']);
    }
    $form_state->setValues($values);
  }

  /**
   * Return an associative array of menus names.
   *
   * @return array
   *   An array with the machine-readable names as the keys, and human-readable
   *   titles as the values.
   */
  protected function getMenuLabels() {
    $menus = [];
    foreach ($this->entityTypeManager->getStorage('menu')->loadMultiple() as $menu_name => $menu) {
      $menus[$menu_name] = $menu->label();
    }
    asort($menus);
    return $menus;
  }

  /**
   * {@inheritdoc}
   */
  public function prepareResults() {
    $results = [];

    $this->addCacheTags(['routes']);

    $url = Url::fromRoute('<front>')->toString();
    $results[$url] = new ValetItem([
      'label' => 'Front Page',
      'description' => 'Go to front page',
      'url' => $url,
      'icon' => $this->getIcon('home'),
    ]);

    foreach ($this->getConfigurationValue('menus', []) as $menu_name) {
      $tree = $this->getMenuTreeElements($menu_name);

      foreach ($tree as $tree_element) {
        $link = $tree_element->link;
        $url = $link->getUrlObject()->toString();
        if (strpos($url, 'token=') !== FALSE) {
          // @todo This is just an ugly workaround for Drupal 8's inability to
          // process URL CSRFs without a render array.
          $urlBubbleable = $link->getUrlObject()->toString(TRUE);
          $urlRender = [
            '#markup' => $urlBubbleable->getGeneratedUrl(),
          ];
          BubbleableMetadata::createFromRenderArray($urlRender)
            ->merge($urlBubbleable)->applyTo($urlRender);
          $url = \Drupal::service('renderer')->renderPlain($urlRender);
        }
        // Redirect token which is replaced via JS with actual url.
        $url = str_replace('/api/valet', 'RETURN_URL', htmlspecialchars_decode($url));
        $icon = $this->getIcon($link->getTitle()) ?: $this->getIcon($link->getProvider());

        $results[$url] = new ValetItem([
          'label' => $link->getTitle(),
          'description' => $link->getDescription(),
          'url' => $url,
          'icon' => $icon,
          'tags' => [
            strtolower(str_replace('_', ' ', $link->getProvider()) . ' ' . $link->getTitle()),
          ],
        ]);

        $tasks = $this->getLocalTasksForRoute($link->getRouteName(), $link->getRouteParameters());
        foreach ($tasks as $route_name => $task) {
          $url = $task['url']->toString();
          if (!isset($results[$url])) {
            $results[$url] = new ValetItem([
              'label' => $link->getTitle() . ': ' . $task['title'],
              'url' => $url,
              'icon' => $icon,
              'description' => $task['description'] ?? $task['title'],
              'tags' => [
                strtolower(str_replace('_', ' ', $link->getProvider()) . ' ' . $link->getTitle() . ' ' . $task['title']),
              ],
            ]);
          }
        }
      }
    }

    return array_values($results);
  }

  /**
   * Retrieves the menu tree elements for the given menu.
   *
   * Every element returned by this method is already access checked.
   *
   * @param string $menu_name
   *   The menu name.
   *
   * @return \Drupal\Core\Menu\MenuLinkTreeElement[]
   *   A flatten array of menu link tree elements for the given menu.
   */
  protected function getMenuTreeElements($menu_name) {
    $parameters = new MenuTreeParameters();
    $tree = $this->menuLinkTree->load($menu_name, $parameters);

    $manipulators = [
      ['callable' => 'menu.default_tree_manipulators:checkNodeAccess'],
      ['callable' => 'menu.default_tree_manipulators:checkAccess'],
      ['callable' => 'menu.default_tree_manipulators:generateIndexAndSort'],
      ['callable' => 'menu.default_tree_manipulators:flatten'],
    ];
    $tree = $this->menuLinkTree->transform($tree, $manipulators);

    // Top-level inaccessible links are *not* removed; it is up
    // to the code doing something with the tree to exclude inaccessible links.
    // @see menu.default_tree_manipulators:checkAccess
    foreach ($tree as $key => $link) {
      $this->addCacheableDependency($link);
      if (!$link->access->isAllowed()) {
        unset($tree[$key]);
      }
    }

    return $tree;
  }

  /**
   * Retrieve all the local tasks for a given route.
   *
   * Every element returned by this method is already access checked.
   *
   * @param string $route_name
   *   The route name for which find the local tasks.
   * @param array $route_parameters
   *   The route parameters.
   *
   * @return array
   *   A flatten array that contains the local tasks for the given route.
   *   Each element in the array is keyed by the route name associated with
   *   the local tasks and contains:
   *     - title: the title of the local task.
   *     - url: the url object for the local task.
   *     - localized_options: the localized options for the local task.
   */
  protected function getLocalTasksForRoute($route_name, array $route_parameters) {
    $links = [];

    $tree = $this->localTaskManager->getLocalTasksForRoute($route_name);
    $route_match = \Drupal::routeMatch();

    foreach ($tree as $instances) {
      /** @var \Drupal\Core\Menu\LocalTaskInterface[] $instances */
      foreach ($instances as $child) {
        $child_route_name = $child->getRouteName();
        // Merges the parent's route parameter with the child ones since you
        // calculate the local tasks outside of parent route context.
        $child_route_parameters = $child->getRouteParameters($route_match) + $route_parameters;
        $this->addCacheableDependency($child);

        if ($this->accessManager->checkNamedRoute($child_route_name, $child_route_parameters)) {
          $links[$child_route_name] = [
            'title' => $child->getTitle(),
            'url' => Url::fromRoute($child_route_name, $child_route_parameters),
            'localized_options' => $child->getOptions($route_match),
          ];
        }
      }
    }

    return count($links) > 1 ? $links : [];
  }

}
